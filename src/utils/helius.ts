import { Connection, PublicKey } from '@solana/web3.js';

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

const HELIUS_URL = `https://api.helius.xyz/v0`;  // Fixed API URL
const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
  commitment: 'confirmed'
});

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
      const result = await fn();
      // Check if result is null or undefined
      if (result === null || result === undefined) {
        throw new Error('Empty result from RPC');
      }
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`Attempt ${i + 1}/${retries + 1} failed:`, lastError.message);
      
      // Check for specific error types
      const errorMessage = lastError.message.toLowerCase();
      if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
        const jitter = Math.random() * 200;
        const delayMs = baseDelay * Math.pow(2, i) + jitter;
        console.log(`Rate limit hit, waiting ${delayMs}ms`);
        await delay(delayMs);
      } else if (errorMessage.includes('timeout') || errorMessage.includes('failed to fetch')) {
        // Network issues - wait a bit longer
        await delay(1000);
      } else {
        // Other errors - shorter delay
        await delay(200);
      }
      
      if (i === retries) {
        throw lastError;
      }
    }
  }
  
  throw lastError;
}

// Interface for Helius token metadata response
interface HeliusTokenMetadata {
  mint: string;
  onChainMetadata: {
    metadata?: {
      name?: string;
      symbol?: string;
      uri?: string;
    };
    tokenInfo?: {
      supply?: string;
    };
  };
  offChainMetadata?: {
    name?: string;
    symbol?: string;
  };
}

// Interface for Helius DAS search response
interface HeliusSearchResponse {
  items: Array<{
    token: {
      mint: string;
      name: string;
      symbol: string;
      supply?: string;
      uri?: string;
    };
  }>;
}

// Helper function for Helius API calls
async function fetchHelius<T>(endpoint: string, data?: unknown): Promise<T> {
  const url = `${HELIUS_URL}${endpoint}?api-key=${HELIUS_API_KEY}`;
  const response = await fetch(url, {
    method: data ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    body: data ? JSON.stringify(data) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Helius API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
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

// Helper function to sanitize text
function sanitizeTokenText(text: string): string {
  // Remove non-printable characters and common garbage patterns
  const cleaned = text.replace(/[^\x20-\x7E]/g, '')  // Keep only printable ASCII
                     .replace(/[^\w\s-]/g, '')        // Remove special characters except dash
                     .trim();
  
  // Return "Unknown" if the cleaned text is too short or empty
  return cleaned.length < 2 ? 'Unknown' : cleaned;
}

// Time range options for historical search
export type TimeRange = '24h' | '7d' | '30d' | 'all';

// Helper function to get milliseconds for time range
function getTimeRangeInMs(range: TimeRange): number {
  switch (range) {
    case '24h':
      return 24 * 60 * 60 * 1000;
    case '7d':
      return 7 * 24 * 60 * 60 * 1000;
    case '30d':
      return 30 * 24 * 60 * 60 * 1000;
    case 'all':
      return Number.MAX_SAFE_INTEGER;
  }
}

export async function searchTokens(query: string, timeRange: TimeRange = '24h'): Promise<TokenInfo[]> {
  try {
    console.log('Starting token search for:', query, 'timeRange:', timeRange);
    const results = new Map<string, TokenInfo>();
    const searchQuery = query.toLowerCase();
    const timeRangeMs = getTimeRangeInMs(timeRange);
    const currentTime = new Date().getTime();

    // First check known tokens
    for (const [symbol, tokenData] of Object.entries(KNOWN_TOKENS)) {
      if (matchesTokenQuery(searchQuery, tokenData.name, symbol, tokenData.address)) {
        try {
          // Get token metadata using Helius API
          const tokenMetadata = await fetchHelius<HeliusTokenMetadata[]>('/token-metadata', {
            mintAccounts: [tokenData.address],
            includeOffChain: true,
          });

          if (tokenMetadata?.[0]) {
            const metadata = tokenMetadata[0].onChainMetadata;
            const offChainMetadata = tokenMetadata[0].offChainMetadata;
            
            results.set(tokenData.address, {
              address: tokenData.address,
              name: metadata?.metadata?.name || offChainMetadata?.name || tokenData.name,
              symbol: metadata?.metadata?.symbol || offChainMetadata?.symbol || tokenData.symbol,
              source: 'known',
              isNewToken: false,
              mintDate: undefined, // We'll fetch this separately if needed
              metadata: {
                name: metadata?.metadata?.name || offChainMetadata?.name || tokenData.name,
                symbol: metadata?.metadata?.symbol || offChainMetadata?.symbol || tokenData.symbol,
                uri: metadata?.metadata?.uri
              }
            });
          }
        } catch (error) {
          console.error('Error fetching known token metadata:', error);
        }
      }
    }

    // Search for tokens using Helius DAS API
    try {
      const searchResults = await fetchHelius<HeliusSearchResponse>('/das/search', {
        query: searchQuery,
        limit: 100,
        displayOptions: {
          showNativeBalance: false,
          showTokenMetadata: true,
          showUnknownTokens: true,
        },
        ownerAddress: null,
        nftCollectionFilter: null,
        tokenType: "fungible",
      });

      if (searchResults?.items) {
        for (const item of searchResults.items) {
          const token = item.token;
          if (!token || results.has(token.mint)) continue;

          try {
            // Get mint date if available
            let mintDate: Date | undefined;
            try {
              const signatures = await connection.getSignaturesForAddress(
                new PublicKey(token.mint),
                { limit: 1 }
              );
              if (signatures[0]?.blockTime) {
                mintDate = new Date(signatures[0].blockTime * 1000);
              }
            } catch (error) {
              console.error('Error fetching mint date:', error);
            }

            const tokenInfo: TokenInfo = {
              address: token.mint,
              name: token.name || 'Unknown',
              symbol: token.symbol || 'Unknown',
              source: 'on-chain',
              isNewToken: mintDate ? (currentTime - mintDate.getTime() <= timeRangeMs) : false,
              mintDate,
              supply: token.supply?.toString() || '0',
              metadata: {
                name: token.name || 'Unknown',
                symbol: token.symbol || 'Unknown',
                uri: token.uri
              }
            };

            // Only include tokens that match our criteria
            if (matchesTokenQuery(searchQuery, tokenInfo.name, tokenInfo.symbol, tokenInfo.address)) {
              results.set(token.mint, tokenInfo);
            }
          } catch (error) {
            console.error('Error processing search result:', error);
          }
        }
      }
    } catch (error) {
      console.error('Error searching tokens:', error);
    }

    console.log('Search completed, total results:', results.size);

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

    // Get token data using Helius API
    try {
      const tokenMetadata = await fetchHelius<HeliusTokenMetadata[]>('/token-metadata', {
        mintAccounts: [address],
        includeOffChain: true,
      });

      if (tokenMetadata?.[0]) {
        const metadata = tokenMetadata[0].onChainMetadata;
        const offChainMetadata = tokenMetadata[0].offChainMetadata;
        const isNewToken = mintDate ? 
          (new Date().getTime() - mintDate.getTime() <= 24 * 60 * 60 * 1000) : 
          false;
        
        return {
          address: address,
          name: metadata?.metadata?.name || offChainMetadata?.name || 'Unknown',
          symbol: metadata?.metadata?.symbol || offChainMetadata?.symbol || 'Unknown',
          source: 'on-chain',
          mintDate,
          isNewToken,
          metadata: {
            name: metadata?.metadata?.name || offChainMetadata?.name || 'Unknown',
            symbol: metadata?.metadata?.symbol || offChainMetadata?.symbol || 'Unknown',
            uri: metadata?.metadata?.uri
          }
        };
      }
    } catch (error) {
      console.error('Error getting token metadata:', error);
    }

    return null;
  } catch (error) {
    console.error('Error getting token details:', error);
    throw error;
  }
} 