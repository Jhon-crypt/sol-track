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

// RPC endpoint for direct Solana connection
const connection = new Connection('https://api.mainnet-beta.solana.com');

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

    // Search recent token mints
    try {
      // Get more signatures to find more recent tokens
      const recentSignatures = await connection.getSignaturesForAddress(
        new PublicKey(TOKEN_PROGRAM_ID),
        { limit: 1000 } // Increased limit to find more tokens
      );

      const mintAddresses = await Promise.all(
        recentSignatures.map(async (sig) => {
          try {
            const tx = await connection.getTransaction(sig.signature);
            if (!tx?.meta?.postTokenBalances?.length) return null;
            
            const mintAddress = tx.meta.postTokenBalances[0].mint;
            const mintDate = tx.blockTime ? new Date(tx.blockTime * 1000) : undefined;
            const isNewToken = mintDate ? (currentTime.getTime() - mintDate.getTime() <= ONE_DAY) : true;
            
            const tokenInfo = await connection.getParsedAccountInfo(new PublicKey(mintAddress));
            
            if (!tokenInfo.value?.data || typeof tokenInfo.value.data !== 'object') return null;
            
            const data = tokenInfo.value.data;
            if ('parsed' in data && data.parsed.type === 'mint') {
              const tokenData = data.parsed.info;
              const name = tokenData.name || 'Unknown';
              const symbol = tokenData.symbol || 'Unknown';

              // Only include tokens that match the search query
              if (!name.toLowerCase().includes(searchQuery) && 
                  !symbol.toLowerCase().includes(searchQuery) &&
                  !mintAddress.toLowerCase().includes(searchQuery)) {
                return null;
              }

              const mint: OnChainToken = {
                address: mintAddress,
                name: name,
                symbol: symbol,
                source: 'on-chain',
                mintDate,
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
        .filter((mint): mint is OnChainToken => mint !== null)
        .forEach(mint => {
          if (!results.has(mint.address)) {
            results.set(mint.address, mint);
          }
        });
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
    // First check Jupiter's list
    const jupiterResponse = await fetch('https://token.jup.ag/all');
    const tokens: JupiterToken[] = await jupiterResponse.json();
    const jupiterToken = tokens.find(t => t.address === address);
    
    let mintDate: Date | undefined;
    
    // Get creation date from on-chain data
    try {
      const signatures = await connection.getSignaturesForAddress(
        new PublicKey(address),
        { limit: 1 }
      );

      if (signatures.length > 0) {
        const tx = await connection.getTransaction(signatures[signatures.length - 1].signature);
        mintDate = tx?.blockTime ? new Date(tx.blockTime * 1000) : undefined;
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
        mintDate,
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
          mintDate,
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