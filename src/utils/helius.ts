import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

// Base interface for token data
interface BaseToken {
  address: string;
  name: string;
  symbol: string;
  mintDate?: Date;
  isNewToken?: boolean;
}

// Main token info interface used throughout the app
export interface TokenInfo extends BaseToken {
  source: string;
  isNewToken: boolean;
}

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

export async function searchTokens(query: string): Promise<TokenInfo[]> {
  try {
    const results = new Map<string, TokenInfo>();
    const searchQuery = query.toLowerCase();
    const currentTime = new Date();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    // Check if the query looks like a contract address
    const isAddressSearch = searchQuery.length >= 32;
    
    if (isAddressSearch) {
      try {
        const tokenInfo = await retryWithBackoff(() => 
          connection.getParsedAccountInfo(new PublicKey(query))
        );

        if (tokenInfo.value?.data && typeof tokenInfo.value.data === 'object') {
          const data = tokenInfo.value.data;
          if ('parsed' in data && data.parsed.type === 'mint') {
            const signatures = await retryWithBackoff(() =>
              connection.getSignaturesForAddress(new PublicKey(query), { limit: 1 })
            );

            if (signatures.length > 0) {
              const mintTx = await retryWithBackoff(() =>
                connection.getTransaction(signatures[0].signature)
              );
              
              const mintDate = mintTx?.blockTime ? new Date(mintTx.blockTime * 1000) : undefined;
              const isNewToken = mintDate ? (currentTime.getTime() - mintDate.getTime() <= ONE_DAY) : false;

              const tokenData = data.parsed.info;
              results.set(query, {
                address: query,
                name: tokenData.name || 'Unknown',
                symbol: tokenData.symbol || 'Unknown',
                source: 'on-chain',
                mintDate,
                isNewToken
              });
            }
          }
        }
      } catch (error) {
        console.error('Error searching by address:', error);
      }
    }

    // Search recent token mints
    try {
      // Get recent signatures with a smaller limit to avoid rate limits
      const recentSignatures = await retryWithBackoff(() =>
        connection.getSignaturesForAddress(
          new PublicKey(TOKEN_PROGRAM_ID),
          { limit: 100 } // Reduced from 1000 to avoid rate limits
        )
      );

      // Process in smaller batches with delay between batches
      const batchSize = 10; // Reduced batch size
      for (let i = 0; i < recentSignatures.length; i += batchSize) {
        const batch = recentSignatures.slice(i, i + batchSize);
        
        // Add delay between batches
        if (i > 0) {
          await delay(500);
        }

        await Promise.all(
          batch.map(async (sig) => {
            try {
              const tx = await retryWithBackoff(() =>
                connection.getParsedTransaction(sig.signature, {
                  maxSupportedTransactionVersion: 0
                })
              );
              
              if (!tx?.meta?.postTokenBalances?.length) return;
              
              // Look through post balances for new token mints
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
                    if (!name.toLowerCase().includes(searchQuery) && 
                        !symbol.toLowerCase().includes(searchQuery) &&
                        !mintAddress.toLowerCase().includes(searchQuery)) {
                      continue;
                    }

                    results.set(mintAddress, {
                      address: mintAddress,
                      name,
                      symbol,
                      source: 'on-chain',
                      mintDate,
                      isNewToken
                    });
                  }
                } catch (error) {
                  console.error('Error processing mint:', error);
                }
              }
            } catch (error) {
              console.error('Error processing transaction:', error);
            }
          })
        );
      }
    } catch (error) {
      console.error('Error searching recent mints:', error);
    }

    // Sort by mint date
    const allTokens = Array.from(results.values());
    const sortedTokens = allTokens.sort((a, b) => {
      if (!a.mintDate && !b.mintDate) return 0;
      if (!a.mintDate) return 1;
      if (!b.mintDate) return -1;
      return b.mintDate.getTime() - a.mintDate.getTime();
    });

    // Put new tokens first
    const newTokens = sortedTokens.filter(token => token.isNewToken);
    const oldTokens = sortedTokens.filter(token => !token.isNewToken);
    
    return [...newTokens, ...oldTokens].slice(0, 50);

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