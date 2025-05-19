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

// Helper function to retry failed requests with exponential backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 5, // Increased retries
  baseDelay = 2000, // Increased base delay
  context = '' // For better error logging
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Log the error with context
      console.error(`Error in ${context} (attempt ${i + 1}/${retries + 1}):`, lastError.message);
      
      if (i === retries) {
        throw lastError;
      }

      // Calculate delay with exponential backoff and jitter
      const jitter = Math.random() * 1000;
      const delayMs = baseDelay * Math.pow(2, i) + jitter;
      
      console.log(`Retrying ${context} in ${Math.round(delayMs)}ms...`);
      await delay(delayMs);
    }
  }
  
  throw lastError;
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

// Helper function to get token info from mint address
async function getTokenInfoFromMint(
  mintAddress: string,
  blockTime?: number | null,
  context = ''
): Promise<TokenInfo | null> {
  try {
    const tokenInfo = await retryWithBackoff(
      () => connection.getParsedAccountInfo(new PublicKey(mintAddress)),
      3,
      1000,
      `getTokenInfo(${mintAddress})`
    );

    if (!tokenInfo.value?.data || typeof tokenInfo.value.data !== 'object') return null;

    const data = tokenInfo.value.data;
    if (!('parsed' in data) || data.parsed.type !== 'mint') return null;

    const tokenData = data.parsed.info;
    const currentTime = new Date();
    const mintDate = blockTime ? new Date(blockTime * 1000) : undefined;
    const isNewToken = mintDate ? (currentTime.getTime() - mintDate.getTime() <= 24 * 60 * 60 * 1000) : false;

    return {
      address: mintAddress,
      name: tokenData.name || 'Unknown',
      symbol: tokenData.symbol || 'Unknown',
      source: 'on-chain',
      mintDate,
      isNewToken,
      supply: tokenData.supply || '0'
    };
  } catch (error) {
    console.error(`Error getting token info for ${mintAddress} (${context}):`, error);
    return null;
  }
}

export async function searchTokens(query: string): Promise<TokenInfo[]> {
  try {
    console.log('Starting token search for:', query);
    const results = new Map<string, TokenInfo>();
    const searchQuery = query.toLowerCase();

    // First check known tokens
    console.log('Checking known tokens...');
    for (const [symbol, tokenData] of Object.entries(KNOWN_TOKENS)) {
      if (matchesTokenQuery(searchQuery, tokenData.name, symbol, tokenData.address)) {
        const tokenInfo = await getTokenInfoFromMint(tokenData.address, undefined, 'known_token');
        if (tokenInfo) {
          tokenInfo.source = 'known';
          results.set(tokenData.address, tokenInfo);
        }
      }
    }

    // Search recent token mints
    try {
      console.log('Fetching recent token program signatures...');
      const recentSignatures = await retryWithBackoff(
        () => connection.getSignaturesForAddress(
          new PublicKey(TOKEN_PROGRAM_ID),
          { limit: 200 } // Reduced limit to avoid rate limits
        ),
        3,
        2000,
        'getSignatures'
      );

      console.log(`Processing ${recentSignatures.length} recent transactions...`);
      
      // Process in smaller batches
      const batchSize = 5;
      for (let i = 0; i < recentSignatures.length && results.size < 100; i += batchSize) {
        const batch = recentSignatures.slice(i, i + batchSize);
        
        // Add delay between batches
        if (i > 0) {
          await delay(1000);
        }

        await Promise.all(
          batch.map(async (sig) => {
            try {
              const tx = await retryWithBackoff(
                () => connection.getParsedTransaction(sig.signature, {
                  maxSupportedTransactionVersion: 0
                }),
                3,
                1000,
                `getTx(${sig.signature.slice(0, 8)})`
              );

              if (!tx?.meta?.postTokenBalances?.length) return;

              // Process each unique mint in the transaction
              const processedMints = new Set<string>();
              for (const balance of tx.meta.postTokenBalances) {
                const mintAddress = balance.mint;
                
                if (processedMints.has(mintAddress) || results.has(mintAddress)) continue;
                processedMints.add(mintAddress);

                const tokenInfo = await getTokenInfoFromMint(mintAddress, tx.blockTime, 'recent_tx');
                if (tokenInfo && matchesTokenQuery(searchQuery, tokenInfo.name, tokenInfo.symbol, mintAddress)) {
                  results.set(mintAddress, tokenInfo);
                }
              }
            } catch (error) {
              console.error('Error processing transaction:', error);
            }
          })
        );
      }
    } catch (error) {
      console.error('Error searching tokens:', error);
    }

    // Sort and return results
    console.log(`Found ${results.size} matching tokens`);
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

    return sortedTokens.slice(0, 100);

  } catch (error) {
    console.error('Error in searchTokens:', error);
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