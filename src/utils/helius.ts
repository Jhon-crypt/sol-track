import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

// Metadata program ID
const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

// Base interface for token data
interface BaseToken {
  address: string;
  name: string;
  symbol: string;
  mintDate?: Date;
  isNewToken?: boolean;
  supply?: string;
  holders?: number;
  metadata?: {
    name: string;
    symbol: string;
    uri?: string;
  };
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

// Cache for recent transactions to avoid re-fetching
interface CachedTransaction {
  meta?: {
    postTokenBalances?: Array<{
      mint: string;
    }>;
  };
  blockTime?: number | null;
}

const transactionCache = new Map<string, CachedTransaction>();

// Helper function to add delay between requests
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Optimized retry function for faster retries on non-rate-limit errors
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseDelay = 500 // Reduced base delay
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Only add significant delay for rate limit errors
      if (lastError.message.includes('rate limit')) {
        const jitter = Math.random() * 200;
        const delayMs = baseDelay * Math.pow(1.5, i) + jitter;
        await delay(delayMs);
      } else {
        // Minimal delay for other errors
        await delay(100);
      }
      
      if (i === retries) {
        throw lastError;
      }
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

// Helper function to get metadata address
function findMetadataAddress(mint: PublicKey): PublicKey {
  const [publicKey] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    METADATA_PROGRAM_ID
  );
  return publicKey;
}

// Optimized token info fetching with metadata
async function getTokenInfoFromMint(
  mintAddress: string,
  blockTime?: number | null
): Promise<TokenInfo | null> {
  try {
    const mintPubkey = new PublicKey(mintAddress);
    const [tokenInfo, metadataInfo] = await Promise.all([
      retryWithBackoff(
        () => connection.getParsedAccountInfo(mintPubkey),
        2
      ),
      retryWithBackoff(
        () => connection.getAccountInfo(findMetadataAddress(mintPubkey)),
        1
      ).catch(() => null) // Ignore metadata errors
    ]);

    if (!tokenInfo.value?.data || typeof tokenInfo.value.data !== 'object') return null;

    const data = tokenInfo.value.data;
    if (!('parsed' in data) || data.parsed.type !== 'mint') return null;

    const tokenData = data.parsed.info;
    const currentTime = new Date();
    const mintDate = blockTime ? new Date(blockTime * 1000) : undefined;
    const isNewToken = mintDate ? (currentTime.getTime() - mintDate.getTime() <= 24 * 60 * 60 * 1000) : false;

    // Try to decode metadata if available
    let metadata;
    if (metadataInfo?.data) {
      try {
        // Skip the metadata account discriminator
        const nameLength = metadataInfo.data[4];
        const name = metadataInfo.data.slice(5, 5 + nameLength).toString('utf8');
        
        const symbolStart = 5 + nameLength;
        const symbolLength = metadataInfo.data[symbolStart];
        const symbol = metadataInfo.data.slice(symbolStart + 1, symbolStart + 1 + symbolLength).toString('utf8');
        
        const uriStart = symbolStart + 1 + symbolLength;
        const uriLength = metadataInfo.data[uriStart];
        const uri = metadataInfo.data.slice(uriStart + 1, uriStart + 1 + uriLength).toString('utf8');

        metadata = { name, symbol, uri };
      } catch {
        // Ignore metadata parsing errors
      }
    }

    // Use metadata values if available, fallback to mint data
    return {
      address: mintAddress,
      name: metadata?.name || tokenData.name || 'Unknown',
      symbol: metadata?.symbol || tokenData.symbol || 'Unknown',
      source: 'on-chain',
      mintDate,
      isNewToken,
      supply: tokenData.supply || '0',
      metadata
    };
  } catch {
    return null; // Skip logging for faster processing
  }
}

export async function searchTokens(query: string): Promise<TokenInfo[]> {
  try {
    const results = new Map<string, TokenInfo>();
    const searchQuery = query.toLowerCase();

    // First check known tokens in parallel
    const knownTokenPromises = Object.entries(KNOWN_TOKENS)
      .filter(([symbol, tokenData]) => matchesTokenQuery(searchQuery, tokenData.name, symbol, tokenData.address))
      .map(async ([, tokenData]) => {
        const tokenInfo = await getTokenInfoFromMint(tokenData.address);
        if (tokenInfo) {
          tokenInfo.source = 'known';
          results.set(tokenData.address, tokenInfo);
        }
      });

    // Wait for known tokens to be processed
    await Promise.all(knownTokenPromises);

    // Get recent signatures
    const recentSignatures = await retryWithBackoff(
      () => connection.getSignaturesForAddress(
        new PublicKey(TOKEN_PROGRAM_ID),
        { limit: 100 } // Reduced limit for faster initial results
      ),
      2
    );

    // Process transactions in parallel batches
    const batchSize = 10; // Increased batch size for parallel processing
    const batches: Array<Promise<void[]>> = [];
    
    for (let i = 0; i < recentSignatures.length && results.size < 100; i += batchSize) {
      const batch = recentSignatures.slice(i, i + batchSize);
      
      const batchPromise = Promise.all(
        batch.map(async (sig) => {
          try {
            // Check cache first
            let tx = transactionCache.get(sig.signature);
            if (!tx) {
              const parsedTx = await retryWithBackoff(
                () => connection.getParsedTransaction(sig.signature, {
                  maxSupportedTransactionVersion: 0
                }),
                2
              );
              
              // Cache the transaction if valid
              if (parsedTx) {
                tx = {
                  meta: {
                    postTokenBalances: parsedTx.meta?.postTokenBalances?.map(balance => ({
                      mint: balance.mint
                    }))
                  },
                  blockTime: parsedTx.blockTime
                };
                transactionCache.set(sig.signature, tx);
                
                // Limit cache size
                if (transactionCache.size > 1000) {
                  const firstKey = Array.from(transactionCache.keys())[0];
                  if (firstKey) {
                    transactionCache.delete(firstKey);
                  }
                }
              }
            }

            if (!tx?.meta?.postTokenBalances?.length) return;

            // Process mints in parallel
            const mintPromises = tx.meta.postTokenBalances
              .map(balance => balance.mint)
              .filter((mintAddress): mintAddress is string => 
                // Deduplicate mints and ensure mint address is valid
                typeof mintAddress === 'string' &&
                !results.has(mintAddress) &&
                mintAddress === tx.meta?.postTokenBalances?.find(
                  b => b.mint === mintAddress
                )?.mint
              )
              .map(async (mintAddress) => {
                const tokenInfo = await getTokenInfoFromMint(mintAddress, tx.blockTime);
                if (tokenInfo && matchesTokenQuery(searchQuery, tokenInfo.name, tokenInfo.symbol, mintAddress)) {
                  results.set(mintAddress, tokenInfo);
                }
              });

            await Promise.all(mintPromises);
          } catch {
            // Skip error logging for faster processing
          }
        })
      );

      batches.push(batchPromise);
      
      // Process batches in parallel but with a small gap
      if (batches.length === 3) {
        await Promise.all(batches);
        batches.length = 0;
        await delay(300); // Small delay between batch groups
      }
    }

    // Wait for any remaining batches
    if (batches.length > 0) {
      await Promise.all(batches);
    }

    // Sort and return results
    const allTokens = Array.from(results.values());
    return allTokens
      .sort((a, b) => {
        // Known tokens first
        if (a.source === 'known' && b.source !== 'known') return -1;
        if (a.source !== 'known' && b.source === 'known') return 1;
        
        // Then by mint date
        if (!a.mintDate && !b.mintDate) return 0;
        if (!a.mintDate) return 1;
        if (!b.mintDate) return -1;
        return b.mintDate.getTime() - a.mintDate.getTime();
      })
      .slice(0, 100);

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