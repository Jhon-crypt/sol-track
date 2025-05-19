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

// Interface for tokens found through on-chain data
interface OnChainToken extends BaseToken {
  source: 'on-chain';
  isNewToken: boolean;
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
  wsEndpoint: `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`,
});

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
        const tokenInfo = await connection.getParsedAccountInfo(new PublicKey(query));
        if (tokenInfo.value?.data && typeof tokenInfo.value.data === 'object') {
          const data = tokenInfo.value.data;
          if ('parsed' in data && data.parsed.type === 'mint') {
            const signatures = await connection.getSignaturesForAddress(
              new PublicKey(query),
              { limit: 10 }
            );

            if (signatures.length > 0) {
              const sortedSigs = signatures.sort((a, b) => 
                (a.blockTime || 0) - (b.blockTime || 0)
              );
              
              const mintTx = await connection.getTransaction(sortedSigs[0].signature);
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

    // Search recent token mints using multiple approaches
    try {
      // First, get recent token program signatures
      const recentSignatures = await connection.getSignaturesForAddress(
        new PublicKey(TOKEN_PROGRAM_ID),
        { limit: 1000 }
      );

      // Process in smaller batches to avoid rate limits
      const batchSize = 50;
      for (let i = 0; i < recentSignatures.length; i += batchSize) {
        const batch = recentSignatures.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(async (sig) => {
            try {
              const tx = await connection.getParsedTransaction(sig.signature, {
                maxSupportedTransactionVersion: 0
              });
              
              if (!tx?.meta?.postTokenBalances?.length) return;
              
              // Look through all post balances for new token mints
              for (const balance of tx.meta.postTokenBalances) {
                const mintAddress = balance.mint;
                
                // Skip if we already found this token
                if (results.has(mintAddress)) continue;
                
                const mintDate = tx.blockTime ? new Date(tx.blockTime * 1000) : undefined;
                const isNewToken = mintDate ? (currentTime.getTime() - mintDate.getTime() <= ONE_DAY) : true;
                
                try {
                  const tokenInfo = await connection.getParsedAccountInfo(new PublicKey(mintAddress));
                  
                  if (!tokenInfo.value?.data || typeof tokenInfo.value.data !== 'object') continue;
                  
                  const data = tokenInfo.value.data;
                  if ('parsed' in data && data.parsed.type === 'mint') {
                    const tokenData = data.parsed.info;
                    const name = tokenData.name || 'Unknown';
                    const symbol = tokenData.symbol || 'Unknown';

                    // Check if token matches search query
                    if (!name.toLowerCase().includes(searchQuery) && 
                        !symbol.toLowerCase().includes(searchQuery) &&
                        !mintAddress.toLowerCase().includes(searchQuery)) {
                      continue;
                    }

                    const mint: OnChainToken = {
                      address: mintAddress,
                      name: name,
                      symbol: symbol,
                      source: 'on-chain',
                      mintDate,
                      isNewToken
                    };
                    
                    results.set(mintAddress, mint);
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