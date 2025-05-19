'use client';

import { useState } from 'react';
import { searchTokens, TokenInfo } from '@/utils/helius';
import { ClipboardIcon, ArrowTopRightOnSquareIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon } from '@heroicons/react/24/solid';

export default function Home() {
  const [searchQuery, setSearchQuery] = useState('');
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setLoading(true);
    setError(null);
    setTokens([]);
    setHasSearched(true);

    try {
      const results = await searchTokens(searchQuery);
      setTokens(results);
    } catch (err) {
      setError('Failed to search tokens. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    if (hasSearched) {
      setHasSearched(false);
      setTokens([]);
      setError(null);
    }
  };

  const copyToClipboard = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
      setTimeout(() => setCopiedAddress(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <main className="min-h-screen bg-[#0F172A] text-white">
      {/* Navigation Bar */}
      <nav className="border-b border-gray-800 bg-[#1E293B]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold">Solana Token Explorer</h1>
            </div>
            <div className="flex items-center space-x-4">
              <a
                href="https://solscan.io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-300 hover:text-white text-sm"
              >
                Solscan
              </a>
              <a
                href="https://explorer.solana.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-300 hover:text-white text-sm"
              >
                Solana Explorer
              </a>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-4xl font-bold text-center text-purple-500 mb-4">Find Any Solana Token</h1>
        <p className="text-gray-400 text-center mb-8">
          Search for any token by name, ticker, or contract address to find its details, including newly minted and unindexed tokens
        </p>

        <div className="flex gap-4 mb-8">
          <div className="relative flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={handleInputChange}
              placeholder="Enter token name, ticker, or paste contract address..."
              className="w-full px-4 py-3 bg-gray-800 rounded-lg border border-gray-700 focus:outline-none focus:border-purple-500 text-white placeholder-gray-500"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setHasSearched(false);
                  setTokens([]);
                  setError(null);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-400"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            )}
          </div>
          <button
            onClick={handleSearch}
            disabled={loading || !searchQuery.trim()}
            className={`px-6 py-3 rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed ${
              loading ? 'cursor-wait' : ''
            }`}
          >
            {loading ? (
              <div className="flex items-center">
                <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Searching...
              </div>
            ) : (
              'Search'
            )}
          </button>
        </div>

        {error && (
          <div className="max-w-2xl mx-auto mb-8">
            <div className="bg-red-900/50 text-red-200 p-4 rounded-lg border border-red-800">
              {error}
            </div>
          </div>
        )}

        {/* Results Section */}
        {tokens.length > 0 && (
          <div className="space-y-8">
            {/* New Tokens Section */}
            {tokens.filter(t => t.isNewToken).length > 0 && (
              <div>
                <h3 className="text-xl font-semibold mb-4 flex items-center">
                  <span className="text-green-400">New Tokens</span>
                  <span className="ml-2 px-2 py-1 text-xs bg-green-900 text-green-300 rounded-full">
                    Last 24h
                  </span>
                </h3>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {tokens
                    .filter(token => token.isNewToken)
                    .map((token) => (
                      <div
                        key={token.address}
                        className="p-4 rounded-lg bg-[#1E293B] border border-green-800 hover:border-green-700 transition-colors duration-200"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="min-w-0 flex-1 mr-3">
                            <h3 className="text-lg font-medium truncate">{token.name}</h3>
                            <p className="text-blue-400 font-mono truncate">{token.symbol}</p>
                            {token.mintDate && (
                              <p className="text-xs text-green-400 mt-1 truncate">
                                Minted: {new Date(token.mintDate).toLocaleDateString()} at{' '}
                                {new Date(token.mintDate).toLocaleTimeString()}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-2 flex-shrink-0">
                            <span className="px-2 py-1 text-xs rounded-full bg-green-900 text-green-300 whitespace-nowrap">
                              {token.source}
                            </span>
                            <span className="text-xs text-gray-500 whitespace-nowrap flex items-center">
                              via Helius
                            </span>
                          </div>
                        </div>
                        
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-400">Contract Address:</span>
                            <div className="flex items-center space-x-2 flex-shrink-0">
                              <button
                                onClick={() => copyToClipboard(token.address)}
                                className="group flex items-center space-x-1 text-gray-400 hover:text-white transition-colors duration-200"
                                title="Copy address"
                              >
                                {copiedAddress === token.address ? (
                                  <CheckCircleIcon className="h-5 w-5 text-green-500" />
                                ) : (
                                  <ClipboardIcon className="h-5 w-5" />
                                )}
                              </button>
                              <a
                                href={`https://solscan.io/token/${token.address}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-gray-400 hover:text-white transition-colors duration-200"
                                title="View on Solscan"
                              >
                                <ArrowTopRightOnSquareIcon className="h-5 w-5" />
                              </a>
                            </div>
                          </div>
                          <div className="relative group">
                            <p className="font-mono text-sm text-gray-300 truncate" title={token.address}>
                              {token.address}
                            </p>
                            <div className="absolute left-0 right-0 -bottom-1 opacity-0 group-hover:opacity-100 transition-opacity bg-[#1E293B] p-2 rounded-md shadow-lg z-10 font-mono text-sm text-gray-300 break-all">
                              {token.address}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Indexed Tokens Section */}
            {tokens.filter(t => !t.isNewToken).length > 0 && (
              <div>
                <h3 className="text-xl font-semibold mb-4">Indexed Tokens</h3>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {tokens
                    .filter(token => !token.isNewToken)
                    .map((token) => (
                      <div
                        key={token.address}
                        className="p-4 rounded-lg bg-[#1E293B] border border-gray-800 hover:border-gray-700 transition-colors duration-200"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="min-w-0 flex-1 mr-3">
                            <h3 className="text-lg font-medium truncate">{token.name}</h3>
                            <p className="text-blue-400 font-mono truncate">{token.symbol}</p>
                            {token.mintDate && (
                              <p className="text-xs text-green-400 mt-1 truncate">
                                Minted: {new Date(token.mintDate).toLocaleDateString()} at{' '}
                                {new Date(token.mintDate).toLocaleTimeString()}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-2 flex-shrink-0">
                            <span className="px-2 py-1 text-xs rounded-full bg-gray-800 text-gray-300 whitespace-nowrap">
                              {token.source}
                            </span>
                            {!token.mintDate && (
                              <span className="text-xs text-gray-500 whitespace-nowrap">Mint date unknown</span>
                            )}
                            <span className="text-xs text-gray-500 whitespace-nowrap flex items-center">
                              via Helius
                            </span>
                          </div>
                        </div>
                        
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-400">Contract Address:</span>
                            <div className="flex items-center space-x-2 flex-shrink-0">
                              <button
                                onClick={() => copyToClipboard(token.address)}
                                className="group flex items-center space-x-1 text-gray-400 hover:text-white transition-colors duration-200"
                                title="Copy address"
                              >
                                {copiedAddress === token.address ? (
                                  <CheckCircleIcon className="h-5 w-5 text-green-500" />
                                ) : (
                                  <ClipboardIcon className="h-5 w-5" />
                                )}
                              </button>
                              <a
                                href={`https://solscan.io/token/${token.address}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-gray-400 hover:text-white transition-colors duration-200"
                                title="View on Solscan"
                              >
                                <ArrowTopRightOnSquareIcon className="h-5 w-5" />
                              </a>
                            </div>
                          </div>
                          <div className="relative group">
                            <p className="font-mono text-sm text-gray-300 truncate" title={token.address}>
                              {token.address}
                            </p>
                            <div className="absolute left-0 right-0 -bottom-1 opacity-0 group-hover:opacity-100 transition-opacity bg-[#1E293B] p-2 rounded-md shadow-lg z-10 font-mono text-sm text-gray-300 break-all">
                              {token.address}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!loading && tokens.length === 0 && hasSearched && (
          <div className="text-center py-12">
            <div className="bg-[#1E293B] rounded-lg p-8 max-w-md mx-auto">
              <p className="text-gray-400 mb-2">
                No tokens found matching &ldquo;{searchQuery}&rdquo;
              </p>
              <p className="text-sm text-gray-500">
                Try searching with a different name or ticker
              </p>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
        )}
      </div>
    </main>
  );
}
