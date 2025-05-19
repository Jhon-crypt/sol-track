import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

// Base interface for token data
interface BaseToken {
  address: string;
  name: string;
  symbol: string;
  createdAt?: Date;
  isNewToken?: boolean;  // Flag for newly minted tokens
}

// Jupiter API response interface
interface JupiterToken extends BaseToken {
  address: string;
  symbol: string;
  name: string;
}

// Interface for tokens found through on-chain data
interface OnChainToken extends BaseToken {
  source: 'on-chain';
  isNewToken: boolean;
}

// Main token info interface used throughout the app
export interface TokenInfo extends BaseToken {
  source: string;  // 'jupiter' | 'on-chain'
  isNewToken: boolean;
}

// RPC endpoint for direct Solana connection
const connection = new Connection('https://api.mainnet-beta.solana.com');

export async function searchTokens(query: string): Promise<TokenInfo[]> {
  try {
    const results = new Map<string, TokenInfo>();
    const searchQuery = query.toLowerCase();
    const currentTime = new Date();
    const ONE_DAY = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    // Check if the query looks like a contract address
    const isAddressSearch = searchQuery.length >= 32;  // Solana addresses are 32-44 chars
    
    if (isAddressSearch) {
      try {
        const tokenDetails = await getTokenDetails(query);
        if (tokenDetails) {
          results.set(tokenDetails.address, tokenDetails);
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
              const isNewToken = createdAt ? (currentTime.getTime() - createdAt.getTime() <= ONE_DAY) : false;

              results.set(token.address, {
                address: token.address,
                name: token.name,
                symbol: token.symbol,
                source: 'jupiter',
                createdAt,
                isNewToken
              });
            } else {
              results.set(token.address, {
                address: token.address,
                name: token.name,
                symbol: token.symbol,
                source: 'jupiter',
                isNewToken: false
              });
            }
          } catch (error) {
            console.error('Error fetching token creation date:', error);
            results.set(token.address, {
              address: token.address,
              name: token.name,
              symbol: token.symbol,
              source: 'jupiter',
              isNewToken: false
            });
          }
        })
      );
    } catch (error) {
      console.error('Error fetching from Jupiter:', error);
    }

    // 2. Search recent token mints (for new tokens)
    try {
      const recentSignatures = await connection.getSignaturesForAddress(
        new PublicKey(TOKEN_PROGRAM_ID),
        { limit: 100 }
      );

      const mintAddresses = await Promise.all(
        recentSignatures.map(async (sig) => {
          try {
            const tx = await connection.getTransaction(sig.signature);
            if (!tx?.meta?.postTokenBalances?.length) return null;
            
            const mintAddress = tx.meta.postTokenBalances[0].mint;
            const createdAt = tx.blockTime ? new Date(tx.blockTime * 1000) : undefined;
            const isNewToken = createdAt ? (currentTime.getTime() - createdAt.getTime() <= ONE_DAY) : true;
            
            const tokenInfo = await connection.getParsedAccountInfo(new PublicKey(mintAddress));
            
            if (!tokenInfo.value?.data || typeof tokenInfo.value.data !== 'object') return null;
            
            const data = tokenInfo.value.data;
            if ('parsed' in data && data.parsed.type === 'mint') {
              const tokenData = data.parsed.info;
              const mint: OnChainToken = {
                address: mintAddress,
                name: tokenData.name || 'Unknown',
                symbol: tokenData.symbol || 'Unknown',
                source: 'on-chain',
                createdAt,
                isNewToken
              };
              return mint;
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
        .filter((mint): mint is OnChainToken => 
          mint !== null && 
          (mint.symbol.toLowerCase().includes(searchQuery) || 
           mint.name.toLowerCase().includes(searchQuery))
        )
        .forEach(mint => {
          if (!results.has(mint.address)) {
            results.set(mint.address, mint);
          }
        });
    } catch (error) {
      console.error('Error searching recent mints:', error);
    }

    // Convert results map to array, sort by creation date (newest first), and separate new tokens
    const allTokens = Array.from(results.values());
    const sortedTokens = allTokens.sort((a, b) => {
      if (!a.createdAt && !b.createdAt) return 0;
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    // Put new tokens first, then the rest
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
        createdAt,
        isNewToken: false
      };
    }

    // If not found in Jupiter, try getting on-chain data
    try {
      const tokenInfo = await connection.getParsedAccountInfo(new PublicKey(address));
      if (!tokenInfo.value?.data || typeof tokenInfo.value.data !== 'object') return null;
      
      const data = tokenInfo.value.data;
      if ('parsed' in data && data.parsed.type === 'mint') {
        const tokenData = data.parsed.info;
        const onChainToken: OnChainToken = {
          address: address,
          name: tokenData.name || 'Unknown',
          symbol: tokenData.symbol || 'Unknown',
          source: 'on-chain',
          createdAt,
          isNewToken: false
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