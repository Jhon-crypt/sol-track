import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

// Base interface for token data
interface BaseToken {
  address: string;
  name: string;
  symbol: string;
  mintDate?: Date;
  isNewToken?: boolean;
  supply?: string;
  holders?: number;
}

// Main token info interface used throughout the app
export interface TokenInfo extends BaseToken {
  source: string;
  isNewToken: boolean;
}

// Known token addresses - helps with initial search but doesn't limit results
const KNOWN_TOKENS: Record<string, { address: string; symbol: string; name: string }> = {
  'BONK': {
    address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    symbol: 'BONK',
    name: 'Bonk'
  }
};

// Use Helius RPC endpoint for better performance
const HELIUS_API_KEY = process.env.NEXT_PUBLIC_HELIUS_API_KEY;
if (!HELIUS_API_KEY) {
  throw new Error('NEXT_PUBLIC_HELIUS_API_KEY is not set in environment variables');
}

const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
  commitment: 'confirmed',
});

// Helper function to add delay between requests
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to retry failed requests
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseDelay = 1000
): Promise<T> {
  try {
    return await fn();
  } catch (error: unknown) {
    if (retries === 0 || !(error instanceof Error) || !error.message?.includes('rate limit')) {
      throw error;
    }
    await delay(baseDelay);
    return retryWithBackoff(fn, retries - 1, baseDelay * 2);
  }
}

// Enhanced token matching to find more related tokens
function matchesTokenQuery(query: string, name: string, symbol: string, address: string): boolean {
  query = query.toLowerCase().trim();
  name = name.toLowerCase().trim();
  symbol = symbol.toLowerCase().trim();
  address = address.toLowerCase().trim();

  // Break query into words for more flexible matching
  const queryWords = query.split(/[\s_-]+/);
  const nameWords = name.split(/[\s_-]+/);
  const symbolWords = symbol.split(/[\s_-]+/);

  // Exact matches first
  if (symbol === query || name === query || address === query) {
    return true;
  }

  // Check if any query word is contained in name or symbol
  for (const word of queryWords) {
    if (word.length < 2) continue; // Skip very short words
    
    // Check for variations of the word in name and symbol
    const variations = [
      word,
      word + 's',
      word.replace(/s$/, ''),
      word + '2',
      word + '3',
      word + 'inu',
      word + 'sol',
      'sol' + word,
      word + 'coin',
      word + 'token',
    ];

    for (const variation of variations) {
      if (name.includes(variation) || symbol.includes(variation)) {
        return true;
      }
    }

    // Check each word in name and symbol
    for (const nameWord of nameWords) {
      if (nameWord.includes(word) || word.includes(nameWord)) {
        return true;
      }
    }
    for (const symbolWord of symbolWords) {
      if (symbolWord.includes(word) || word.includes(symbolWord)) {
        return true;
      }
    }
  }

  // Check for common token naming patterns
  const commonPatterns = [
    query + 'inu',
    query + 'sol',
    'sol' + query,
    query + 'coin',
    query + 'token',
    query + '2',
    query + '3',
  ];

  for (const pattern of commonPatterns) {
    if (name.includes(pattern) || symbol.includes(pattern)) {
      return true;
    }
  }

  // Partial matches
  return symbol.includes(query) || 
         query.includes(symbol) ||
         name.includes(query) ||
         address.includes(query);
}

export async function searchTokens(query: string): Promise<TokenInfo[]> {
  try {
    const results = new Map<string, TokenInfo>();
    const searchQuery = query.toLowerCase();
    const currentTime = new Date();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    // First check known tokens but don't stop here
    for (const [symbol, tokenData] of Object.entries(KNOWN_TOKENS)) {
      if (matchesTokenQuery(searchQuery, tokenData.name, symbol, tokenData.address)) {
        try {
          const tokenInfo = await retryWithBackoff(() =>
            connection.getParsedAccountInfo(new PublicKey(tokenData.address))
          );

          if (tokenInfo.value?.data && typeof tokenInfo.value.data === 'object') {
            const data = tokenInfo.value.data;
            if ('parsed' in data && data.parsed.type === 'mint') {
              const signatures = await retryWithBackoff(() =>
                connection.getSignaturesForAddress(new PublicKey(tokenData.address), { limit: 1 })
              );

              const mintDate = signatures[0]?.blockTime ? new Date(signatures[0].blockTime * 1000) : undefined;
              const isNewToken = mintDate ? (currentTime.getTime() - mintDate.getTime() <= ONE_DAY) : false;

              results.set(tokenData.address, {
                address: tokenData.address,
                name: tokenData.name,
                symbol: tokenData.symbol,
                source: 'known',
                mintDate,
                isNewToken,
                supply: data.parsed.info.supply || '0'
              });
            }
          }
        } catch (error) {
          console.error(`Error fetching known token ${symbol}:`, error);
        }
      }
    }

    // Search recent token mints with increased limit
    try {
      // Get more recent signatures to find more tokens
      const recentSignatures = await retryWithBackoff(() =>
        connection.getSignaturesForAddress(
          new PublicKey(TOKEN_PROGRAM_ID),
          { limit: 500 } // Increased to find more tokens
        )
      );

      // Process in smaller batches with delay between batches
      const batchSize = 10;
      for (let i = 0; i < recentSignatures.length; i += batchSize) {
        const batch = recentSignatures.slice(i, i + batchSize);
        
        if (i > 0) {
          await delay(500); // Reduced delay to process more tokens faster
        }

        await Promise.all(
          batch.map(async (sig) => {
            try {
              const tx = await retryWithBackoff(() =>
                connection.getParsedTransaction(sig.signature, {
                  maxSupportedTransactionVersion: 0
                })
              );
              
              // Look through all token balances, not just mints
              if (tx?.meta?.postTokenBalances?.length) {
                for (const balance of tx.meta.postTokenBalances) {
                  const mintAddress = balance.mint;
                  
                  // Skip if already found
                  if (results.has(mintAddress)) continue;
                  
                  const mintDate = tx.blockTime ? new Date(tx.blockTime * 1000) : undefined;
                  const isNewToken = mintDate ? (currentTime.getTime() - mintDate.getTime() <= ONE_DAY) : true;
                  
                  try {
                    const tokenInfo = await retryWithBackoff(() =>
                      connection.getParsedAccountInfo(new PublicKey(mintAddress))
                    );
                    
                    if (!tokenInfo.value?.data || typeof tokenInfo.value.data !== 'object') continue;
                    
                    const data = tokenInfo.value.data;
                    if ('parsed' in data && data.parsed.type === 'mint') {
                      const tokenData = data.parsed.info;
                      const name = tokenData.name || 'Unknown';
                      const symbol = tokenData.symbol || 'Unknown';

                      // Check if matches search query
                      if (!matchesTokenQuery(searchQuery, name, symbol, mintAddress)) {
                        continue;
                      }

                      results.set(mintAddress, {
                        address: mintAddress,
                        name,
                        symbol,
                        source: 'on-chain',
                        mintDate,
                        isNewToken,
                        supply: tokenData.supply || '0'
                      });
                    }
                  } catch (error) {
                    console.error('Error processing token:', error);
                  }
                }
              }
            } catch (error) {
              console.error('Error processing transaction:', error);
            }
          })
        );

        // If we've found a lot of tokens, break early
        if (results.size >= 200) {
          break;
        }
      }
    } catch (error) {
      console.error('Error searching tokens:', error);
    }

    // Sort tokens
    const allTokens = Array.from(results.values());
    const sortedTokens = allTokens.sort((a, b) => {
      // Known tokens first
      if (a.source === 'known' && b.source !== 'known') return -1;
      if (a.source !== 'known' && b.source === 'known') return 1;
      
      // Then by mint date
      if (!a.mintDate && !b.mintDate) return 0;
      if (!a.mintDate) return 1;
      if (!b.mintDate) return -1;
      return b.mintDate.getTime() - a.mintDate.getTime();
    });

    // Return more results
    return sortedTokens.slice(0, 100); // Increased limit to show more tokens

  } catch (error) {
    console.error('Error searching tokens:', error);
    throw error;
  }
}

export async function getTokenDetails(address: string): Promise<TokenInfo | null> {
  try {
    let mintDate: Date | undefined;
    
    // Get mint date from on-chain data
    try {
      const signatures = await connection.getSignaturesForAddress(
        new PublicKey(address),
        { limit: 10 }
      );

      if (signatures.length > 0) {
        // Sort to get the earliest transaction
        const sortedSigs = signatures.sort((a, b) => 
          (a.blockTime || 0) - (b.blockTime || 0)
        );
        
        const tx = await connection.getTransaction(sortedSigs[0].signature);
        mintDate = tx?.blockTime ? new Date(tx.blockTime * 1000) : undefined;
      }
    } catch (error) {
      console.error('Error fetching token mint date:', error);
    }

    // Get token data
    try {
      const tokenInfo = await connection.getParsedAccountInfo(new PublicKey(address));
      if (!tokenInfo.value?.data || typeof tokenInfo.value.data !== 'object') return null;
      
      const data = tokenInfo.value.data;
      if ('parsed' in data && data.parsed.type === 'mint') {
        const tokenData = data.parsed.info;
        const isNewToken = mintDate ? 
          (new Date().getTime() - mintDate.getTime() <= 24 * 60 * 60 * 1000) : 
          false;
        
        return {
          address: address,
          name: tokenData.name || 'Unknown',
          symbol: tokenData.symbol || 'Unknown',
          source: 'on-chain',
          mintDate,
          isNewToken
        };
      }
    } catch (error) {
      console.error('Error getting on-chain token details:', error);
    }

    return null;
  } catch (error) {
    console.error('Error getting token details:', error);
    throw error;
  }
} 