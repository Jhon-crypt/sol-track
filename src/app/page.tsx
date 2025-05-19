'use client';

import { useState } from 'react';
import { searchTokens, TokenInfo } from '@/utils/helius';
import { MagnifyingGlassIcon, ClipboardIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon } from '@heroicons/react/24/solid';

export default function Home() {
  const [searchQuery, setSearchQuery] = useState('');
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setLoading(true);
    setError(null);
    setTokens([]);

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

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search Section */}
        <div className="mb-8">
          <div className="max-w-3xl mx-auto text-center mb-8">
            <h2 className="text-3xl font-bold mb-4 bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">
              Find Any Solana Token
            </h2>
            <p className="text-gray-400">
              Search for any token by name or ticker to find its contract address, including newly minted and unindexed tokens
            </p>
          </div>

          <form onSubmit={handleSearch} className="max-w-2xl mx-auto">
            <div className="flex gap-4">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Enter token name or ticker (e.g., BONK, DUST)"
                  className="w-full px-4 py-3 rounded-lg bg-[#1E293B] border border-gray-700 text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <MagnifyingGlassIcon className="h-5 w-5 absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500" />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
              >
                {loading ? 'Searching...' : 'Search'}
              </button>
            </div>
          </form>
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
          <div className="space-y-4">
            <h3 className="text-xl font-semibold mb-4">Search Results</h3>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {tokens.map((token) => (
                <div
                  key={token.address}
                  className="p-4 rounded-lg bg-[#1E293B] border border-gray-800 hover:border-gray-700 transition-colors duration-200"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-lg font-medium">{token.name}</h3>
                      <p className="text-blue-400 font-mono">{token.symbol}</p>
                    </div>
                    <span className="px-2 py-1 text-xs rounded-full bg-gray-800 text-gray-300">
                      {token.source}
                    </span>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-400">Contract Address:</span>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => copyToClipboard(token.address)}
                          className="group flex items-center space-x-1 text-gray-400 hover:text-white transition-colors duration-200"
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
                        >
                          <ArrowTopRightOnSquareIcon className="h-5 w-5" />
                        </a>
                      </div>
                    </div>
                    <p className="font-mono text-sm text-gray-300 break-all">
                      {token.address}
                    </p>
                    {token.createdAt && (
                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-sm text-gray-400">Created:</span>
                        <span className="text-sm text-gray-300">
                          {new Date(token.createdAt).toLocaleDateString()} {new Date(token.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && tokens.length === 0 && searchQuery && (
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
