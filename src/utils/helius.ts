import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  source: string;
  createdAt?: Date;
}

export interface JupiterToken {
  address: string;
  chainId: number;
  decimals: number;
  name: string;
  symbol: string;
  logoURI?: string;
  tags?: string[];
}

export type TimeRange = '1d' | '7d' | '30d' | 'all';

interface SearchOptions {
  timeRange?: TimeRange;
  limit?: number;
}

const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  timeRange: 'all',
  limit: 100
};

// Helper function to get the timestamp for a time range
function getStartTimestamp(timeRange: TimeRange): number | null {
  if (timeRange === 'all') return null;
  
  const now = Date.now();
  const days = {
    '1d': 1,
    '7d': 7,
    '30d': 30
  }[timeRange];
  
  return Math.floor((now - days * 24 * 60 * 60 * 1000) / 1000); // Convert to seconds
}

const connection = new Connection(process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com');

export async function searchTokens(query: string, options: SearchOptions = DEFAULT_SEARCH_OPTIONS): Promise<TokenInfo[]> {
  try {
    const results = new Map<string, TokenInfo>();
    const searchQuery = query.toLowerCase();
    const startTime = getStartTimestamp(options.timeRange || 'all');

    // Check if the query looks like a contract address
    const isAddressSearch = searchQuery.length >= 32;
    
    if (isAddressSearch) {
      try {
        const tokenDetails = await getTokenDetails(query);
        if (tokenDetails) {
          // Only include if within time range
          if (!startTime || (tokenDetails.createdAt && tokenDetails.createdAt.getTime() / 1000 >= startTime)) {
            results.set(tokenDetails.address, tokenDetails);
          }
          return Array.from(results.values());
        }
      } catch (error) {
        console.error('Error searching by address:', error);
      }
    }

    // 1. Search Jupiter's token list (fastest source)
    try {
      const jupiterResponse = await fetch('https://token.jup.ag/all');
      const jupiterTokens: JupiterToken[] = await jupiterResponse.json();
      
      // Filter tokens first to minimize API calls
      const matchingTokens = jupiterTokens.filter((token) => 
        token.symbol.toLowerCase().includes(searchQuery) || 
        token.name.toLowerCase().includes(searchQuery) ||
        token.address.toLowerCase().includes(searchQuery)
      );

      // Get creation dates for matching tokens
      await Promise.all(
        matchingTokens.map(async (token) => {
          try {
            const signatures = await connection.getSignaturesForAddress(
              new PublicKey(token.address),
              { limit: 1 }
            );

            if (signatures.length > 0) {
              const tx = await connection.getTransaction(signatures[signatures.length - 1].signature);
              const createdAt = tx?.blockTime ? new Date(tx.blockTime * 1000) : undefined;

              // Only add if within time range
              if (!startTime || (createdAt && createdAt.getTime() / 1000 >= startTime)) {
                results.set(token.address, {
                  address: token.address,
                  name: token.name,
                  symbol: token.symbol,
                  source: 'jupiter',
                  createdAt
                });
              }
            }
          } catch (error) {
            console.error('Error fetching token creation date:', error);
            // Still add the token if we can't get its creation date and no time filter
            if (!startTime) {
              results.set(token.address, {
                address: token.address,
                name: token.name,
                symbol: token.symbol,
                source: 'jupiter'
              });
            }
          }
        })
      );
    } catch (error) {
      console.error('Error fetching from Jupiter:', error);
    }

    // 2. Search recent token mints
    try {
      const searchLimit = options.limit || 100;
      const recentSignatures = await connection.getSignaturesForAddress(
        new PublicKey(TOKEN_PROGRAM_ID),
        { 
          limit: searchLimit,
          ...(startTime ? { until: startTime.toString() } : {})
        }
      );

      const mintAddresses = await Promise.all(
        recentSignatures.map(async (sig) => {
          try {
            const tx = await connection.getTransaction(sig.signature);
            if (!tx?.meta?.postTokenBalances?.length) return null;
            
            const mintAddress = tx.meta.postTokenBalances[0].mint;
            const createdAt = tx.blockTime ? new Date(tx.blockTime * 1000) : undefined;
            
            // Skip if outside time range
            if (startTime && (!createdAt || createdAt.getTime() / 1000 < startTime)) {
              return null;
            }

            const tokenInfo = await connection.getParsedAccountInfo(new PublicKey(mintAddress));
            
            if (!tokenInfo.value?.data || typeof tokenInfo.value.data !== 'object') return null;
            
            const data = tokenInfo.value.data;
            if ('parsed' in data && data.parsed.type === 'mint') {
              const tokenData = data.parsed.info;
              const name = tokenData.name || 'Unknown';
              const symbol = tokenData.symbol || 'Unknown';
              
              // Only include if matches search
              if (name.toLowerCase().includes(searchQuery) || 
                  symbol.toLowerCase().includes(searchQuery) ||
                  mintAddress.toLowerCase().includes(searchQuery)) {
                return {
                  address: mintAddress,
                  name,
                  symbol,
                  source: 'on-chain',
                  createdAt
                };
              }
            }
            return null;
          } catch (error) {
            console.error('Error processing transaction:', error);
            return null;
          }
        })
      );

      // Add valid mint addresses to results
      mintAddresses
        .filter((mint): mint is NonNullable<typeof mint> => mint !== null)
        .forEach(mint => {
          if (!results.has(mint.address)) {
            results.set(mint.address, mint);
          }
        });
    } catch (error) {
      console.error('Error searching recent mints:', error);
    }

    return Array.from(results.values()).slice(0, 50);
  } catch (error) {
    console.error('Error searching tokens:', error);
    throw error;
  }
}

export async function getTokenDetails(address: string): Promise<TokenInfo | null> {
  try {
    // First check Jupiter's list
    const jupiterResponse = await fetch('https://token.jup.ag/all');
    const tokens: JupiterToken[] = await jupiterResponse.json();
    const jupiterToken = tokens.find(t => t.address === address);
    
    let createdAt: Date | undefined;
    
    // Get creation date from on-chain data
    try {
      const signatures = await connection.getSignaturesForAddress(
        new PublicKey(address),
        { limit: 1 }
      );

      if (signatures.length > 0) {
        const tx = await connection.getTransaction(signatures[signatures.length - 1].signature);
        createdAt = tx?.blockTime ? new Date(tx.blockTime * 1000) : undefined;
      }
    } catch (error) {
      console.error('Error fetching token creation date:', error);
    }
    
    if (jupiterToken) {
      return {
        address: jupiterToken.address,
        name: jupiterToken.name,
        symbol: jupiterToken.symbol,
        source: 'jupiter',
        createdAt
      };
    }

    // If not found in Jupiter, try getting on-chain data
    try {
      const tokenInfo = await connection.getParsedAccountInfo(new PublicKey(address));
      if (!tokenInfo.value?.data || typeof tokenInfo.value.data !== 'object') return null;
      
      const data = tokenInfo.value.data;
      if ('parsed' in data && data.parsed.type === 'mint') {
        const tokenData = data.parsed.info;
        const onChainToken: TokenInfo = {
          address: address,
          name: tokenData.name || 'Unknown',
          symbol: tokenData.symbol || 'Unknown',
          source: 'on-chain',
          createdAt
        };
        return onChainToken;
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