"use client";

import { Dispatch, SetStateAction, useEffect, useState, useCallback, useRef } from "react";
import { NFTCard } from "./NFTcard";
import { useAccount, useProvider, useConnect } from "@starknet-react/core";
import { Contract } from "starknet";
import { notification } from "~~/utils/scaffold-stark";
import { getNFTMetadataFromIPFS, addToIPFS } from "~~/utils/simpleNFT/ipfs";
import { NFTMetaData } from "~~/utils/simpleNFT/nftsMetadata";
import { useDynamicScaffoldWriteContract } from "~~/hooks/scaffold-stark/useDynamicScaffoldWriteContract";


export interface Collectible extends Partial<NFTMetaData> {
  id: number;
  uri: string;
  owner: string;
}

export interface ContractData {
  address: string;
  name: string;
  symbol: string;
  totalSupply: number;
}

// Rate limiting utility
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const MyHoldings = ({
  contract,
  abi,
  onRefresh,
}: {
  contract: ContractData;
  abi: any[];
  onRefresh?: () => void;
}) => {
  const { address: connectedAddress, account, status, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { provider } = useProvider();
  
  const [myCollectibles, setMyCollectibles] = useState<Collectible[]>([]);
  const [collectiblesLoading, setCollectiblesLoading] = useState(false);
  const [showMintForm, setShowMintForm] = useState(false);
  const [userBalance, setUserBalance] = useState(0);
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0 });
  
  // Add internal refresh trigger
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Minting form state
  const [mintToAddress, setMintToAddress] = useState("");
  const [ipfsHash, setIpfsHash] = useState("");
  const [nftName, setNftName] = useState("");
  const [nftDescription, setNftDescription] = useState("");
  const [nftImage, setNftImage] = useState("");

  // Use refs to prevent dependency issues
  const contractRef = useRef(contract);
  const abiRef = useRef(abi);
  const onRefreshRef = useRef(onRefresh);
  
  // State change triggers
  const [txHash, settxHash] = useState<string | undefined>(undefined);
  const [transferTx, setTransferTx] = useState<string | undefined>(undefined);

  useEffect(() => {
    contractRef.current = contract;
    abiRef.current = abi;
    onRefreshRef.current = onRefresh;
  }, [contract, abi, onRefresh]);

  // Setup scaffold write hooks for minting
  const {
    sendAsync: mintItem,
    isPending: isMintingTx,
  } = useDynamicScaffoldWriteContract({
    contractAddress: contract.address,
    contractAbi: abi,
    functionName: "mint_item",
    args: [],
  });

  // Helper function to ensure address is in string format
  const ensureAddressString = (address: any): string => {
    if (typeof address === "bigint") {
      return `0x${address.toString(16)}`;
    }
    if (typeof address === "string") {
      return address;
    }
    return String(address);
  };

  // Internal refresh function
  const triggerRefresh = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  // Extract IPFS hash from various URI formats
  const extractIpfsHash = useCallback((uri: string): string => {
    if (!uri) return "";
    
    // Handle different IPFS URI formats
    const ipfsPatterns = [
      /ipfs:\/\/(.+)/,                           // ipfs://hash
      /https:\/\/ipfs\.io\/ipfs\/(.+)/,          // https://ipfs.io/ipfs/hash
      /https:\/\/gateway\.pinata\.cloud\/ipfs\/(.+)/, // Pinata gateway
      /https:\/\/.+\.ipfs\..+\/(.+)/,            // Generic IPFS gateway
      /^(Qm[1-9A-HJ-NP-Za-km-z]{44})$/,         // Direct hash (Qm format)
      /^(b[A-Za-z2-7]{58})$/,                   // Direct hash (b format)
      /^(z[1-9A-HJ-NP-Za-km-z]{48})$/,          // Direct hash (z format)
    ];
    
    for (const pattern of ipfsPatterns) {
      const match = uri.match(pattern);
      if (match) {
        return match[1] || match[0];
      }
    }
    
    return "";
  }, []);

  // Sequential NFT processing with rate limiting and improved IPFS handling
  const processNFTsSequentially = useCallback(async (
    nftContract: Contract, 
    connectedAddress: string, 
    userBalanceValue: number
  ) => {
    const collectibles: Collectible[] = [];

 

    setLoadingProgress({ current: 0, total: userBalanceValue });

    for (let i = 0; i < userBalanceValue; i++) {
      setLoadingProgress({ current: i + 1, total: userBalanceValue });

      try {
        console.log(`📋 Processing NFT ${i + 1}/${userBalanceValue}...`);
        
        // Sequential calls with delays to respect rate limits
        const tokenIdResponse = await nftContract.call("token_of_owner_by_index", [connectedAddress, i]);
        await delay(150); // 150ms delay between calls
        
        const tokenId = Number(Array.isArray(tokenIdResponse) ? tokenIdResponse[0] : tokenIdResponse);
        
        const tokenURIResponse = await nftContract.call("token_uri", [tokenId]);
        await delay(150); // 150ms delay between calls
        
        const tokenURI = Array.isArray(tokenURIResponse) ? tokenURIResponse.join("") : String(tokenURIResponse);
        
        let metadata: NFTMetaData = {
          description: "",
          external_url: "",
          image: "",
          name: `Token #${tokenId}`,
          attributes: [],
        };

        // Try to fetch metadata with improved IPFS handling
        if (tokenURI) {
          try {
            const ipfsHash = extractIpfsHash(tokenURI);
            
            if (ipfsHash) {
              console.log(`🌐 Fetching IPFS metadata for token ${tokenId} with hash: ${ipfsHash}`);
              
              // Use our server-side API route instead of direct IPFS calls
              const metadataPromise = getNFTMetadataFromIPFS(ipfsHash);
              const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('API timeout')), 10000) // Increased timeout
              );
              
              metadata = await Promise.race([metadataPromise, timeoutPromise]) as NFTMetaData;
              console.log(`✅ Metadata fetched for token ${tokenId}:`, metadata.name);
              
              // Add delay after metadata fetch
              await delay(300);
            } else {
              console.log(`⚠️ Could not extract IPFS hash from URI: ${tokenURI}`);
            }
          } catch (metadataError: any) {
            console.warn(`⚠️ Could not fetch metadata for token ${tokenId}:`, metadataError?.message || metadataError);
            
            // If it's a network error, add a longer delay before continuing
            if (metadataError?.message?.includes('fetch') || metadataError?.message?.includes('network')) {
              await delay(1000);
            }
          }
        }
        
        // Handle image URL - convert IPFS URIs to HTTP gateways for display
        let finalImage = metadata.image || `https://via.placeholder.com/300?text=NFT+${tokenId}`;
        
        if (finalImage.startsWith('ipfs://')) {
          const imageHash = finalImage.replace('ipfs://', '');
          finalImage = `https://ipfs.io/ipfs/${imageHash}`;
        }
        
        collectibles.push({
          id: tokenId,
          uri: tokenURI,
          owner: connectedAddress,
          name: metadata.name || `Token #${tokenId}`,
          description: metadata.description || `NFT Token #${tokenId}`,
          image: finalImage,
          attributes: metadata.attributes || [],
        });
        
        console.log(`✅ Token ${tokenId} processed successfully (${i + 1}/${userBalanceValue})`);
        
      } catch (tokenError) {
        console.error(`❌ Error processing token ${i}:`, tokenError);
        // Continue with next token instead of breaking
        
        // Add a longer delay if we hit an error
        if (i < userBalanceValue - 1) {
          await delay(500);
        }
      }

      // Add delay between processing different NFTs (except for the last one)
      if (i < userBalanceValue - 1) {
        await delay(300); // 300ms between NFTs
      }
    }

    return collectibles;
  }, [extractIpfsHash]);

  // MAIN EFFECT - Back to your original approach with minimal changes
  useEffect(() => {
    const updateMyCollectibles = async (): Promise<void> => {
      console.log("🔄 Starting collectibles fetch with rate limiting...");
      
      // Early returns to prevent unnecessary processing
      if (!provider || !connectedAddress) {
        console.log("❌ No provider or connected address");
        setMyCollectibles([]);
        setUserBalance(0);
        setCollectiblesLoading(false);
        return;
      }

      // Prevent multiple simultaneous requests
      setCollectiblesLoading(true);
      setLoadingProgress({ current: 0, total: 0 });

      try {
        const currentContract = contractRef.current;
        const currentAbi = abiRef.current;
        
        const addressString = ensureAddressString(currentContract.address);
        const nftContract = new Contract(currentAbi, addressString, provider);
      
        console.log("📞 Fetching total supply...");
        const totalSupplyResult = await nftContract.call("total_supply");
        contract.totalSupply = Number(totalSupplyResult);
        await delay(200); // Delay after total supply call
        
        console.log("📞 Fetching balance...");
        const balance = await nftContract.call("balance_of", [connectedAddress]);
        const userBalanceValue = Number(Array.isArray(balance) ? balance[0] : balance);
        await delay(200); // Delay after balance call
        
        console.log("✅ Balance:", userBalanceValue);
        setUserBalance(userBalanceValue);

        if (userBalanceValue === 0) {
          console.log("⚪ Zero balance");
          setMyCollectibles([]);
          return;
        }

        console.log(`🚀 Processing ${userBalanceValue} NFTs sequentially...`);
        
        // Process NFTs one by one with rate limiting
        const collectibles = await processNFTsSequentially(nftContract, connectedAddress, userBalanceValue);

        console.log("🎉 Setting collectibles:", collectibles.length);
        console.log("Collectibles data:", collectibles);
        
        // CRITICAL FIX: Make sure we set the state with the complete array
        setMyCollectibles(collectibles);
        
      } catch (error) {
        console.error("💥 Error:", error);
        setMyCollectibles([]);
        notification.error("Error fetching NFTs for this contract");
      } finally {
        console.log("🏁 Setting loading to false");
        setCollectiblesLoading(false);
        setLoadingProgress({ current: 0, total: 0 });
      }
    };

    // Only run if we have the minimum required data
    if (connectedAddress && provider && contract.address) {
      updateMyCollectibles();
    } else {
      setCollectiblesLoading(false);
      setMyCollectibles([]);
      setUserBalance(0);
    }
    
    // CRITICAL: Minimal dependencies to prevent infinite loops
  }, [connectedAddress, provider, contract.address, refreshTrigger, txHash, transferTx, processNFTsSequentially]);

  const handleMintWithMetadata = async () => {
    if (!isConnected || status !== "connected" || !connectedAddress) {
      notification.error("Please connect your wallet first");
      return;
    }

    const targetAddress = mintToAddress.trim() || connectedAddress;
    if (!targetAddress) {
      notification.error("No address specified for minting");
      return;
    }

    try {
      let finalIpfsHash = ipfsHash;

      if (!ipfsHash && (nftName || nftDescription || nftImage)) {
        const metadata: NFTMetaData = {
          name: nftName || `${contractRef.current.symbol} #${contractRef.current.totalSupply + 1}`,
          description: nftDescription || `A unique NFT from ${contractRef.current.name}`,
          image: nftImage || "",
          attributes: [],
          external_url: "",
        };

        const notificationId = notification.loading("Uploading metadata to IPFS...");
        try {
          const uploadedItem = await addToIPFS(metadata);
          finalIpfsHash = uploadedItem.cid;
          notification.remove(notificationId);
          notification.success("Metadata uploaded to IPFS successfully!");
        } catch (uploadError) {
          notification.remove(notificationId);
          throw new Error("Failed to upload metadata to IPFS");
        }
      }

      const mintNotification = notification.loading("Minting NFT... Please approve transaction in your wallet.");
      console.log("Attempting to mint with args:", [targetAddress, finalIpfsHash || ""]);

      const response = await mintItem({
        args: [targetAddress, finalIpfsHash || ""],
      });
      
      if (response && provider) {
        const txReceipt = await provider.waitForTransaction(response);
        console.log("Transaction receipt:", txReceipt);
        const result = txReceipt.isSuccess();
        
        notification.remove(mintNotification);
        
        if (result) {
          settxHash(response);
          notification.success(`NFT minted successfully! Tx Hash: ${response}`, { duration: 8000 });

          // Reset form
          setMintToAddress("");
          setIpfsHash("");
          setNftName("");
          setNftDescription("");
          setNftImage("");
          setShowMintForm(false);

          // Trigger refresh
          triggerRefresh();
          
          // Call parent refresh if provided
          if (onRefreshRef.current) onRefreshRef.current();
        } else {
          notification.error("NFT minting failed");
        }
      }
    } catch (error) {
      console.error("Minting error:", error);
      notification.error("Failed to mint NFT. Check console for details.");
    }
  };

  const handleMintSimple = async () => {
    if (!isConnected || status !== "connected" || !connectedAddress) {
      notification.error("Please connect your wallet first");
      return;
    }

    try {
      const mintNotification = notification.loading("Minting NFT... Please approve transaction in your wallet.");
      console.log("Attempting to mint with args:", [connectedAddress]);

      const response = await mintItem({
        args: [connectedAddress, "bafkreih5gyovodhf37hjtjfhm5p7yauowlkyjnc5xawah5owq4hho6vh5i"],
      });
      
      if (response && provider) {
        const txReceipt = await provider.waitForTransaction(response);
        console.log("Transaction receipt:", txReceipt);
        const result = txReceipt.isSuccess();
        
        notification.remove(mintNotification);
        
        if (result) {
          settxHash(response);
          notification.success(`NFT minted successfully! Tx Hash: ${response}`, { duration: 8000 });
          
          triggerRefresh();
          if (onRefreshRef.current) onRefreshRef.current();
        } else {
          notification.error("NFT minting failed");
        }
      }
    } catch (error) {
      console.error("Simple Minting error:", error);
      notification.error("Failed to mint NFT. Check console for details.");
    }
  };

  if (!connectedAddress) {
    return (
      <div className="flex justify-center items-center py-16">
        <div className="text-center">
          <p className="text-xl text-gray-500 mb-4">Please connect your wallet to view your NFTs.</p>
          <button className="btn btn-primary" onClick={() => connect({ connector: connectors[0] })}>
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-4 text-center">
        <h3 className="text-xl font-semibold text-primary">{contract.name}</h3>
        <p className="text-sm text-gray-600">
          {contract.symbol} • Total Supply: {contract.totalSupply} • 
          <span className="font-mono text-xs ml-1">
            {contract.address.slice(0, 6)}...{contract.address.slice(-4)}
          </span>
        </p>
      </div>

      {/* Minting Section */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-4">
          <h4 className="text-lg font-semibold">Mint NFT</h4>
          <div className="badge badge-info">Your Balance: {userBalance}</div>
        </div>

        <div className="flex gap-2 mb-4">
          <button
            className="btn btn-primary btn-sm"
            onClick={handleMintSimple}
            disabled={isMintingTx || collectiblesLoading}
          >
            {isMintingTx ? (
              <>
                <span className="loading loading-spinner loading-xs"></span>
                Minting...
              </>
            ) : (
              "Quick Mint"
            )}
          </button>

          <button
            className="btn btn-outline btn-sm"
            onClick={() => setShowMintForm(!showMintForm)}
            disabled={isMintingTx || collectiblesLoading}
          >
            {showMintForm ? "Hide" : "Advanced Mint"}
          </button>
        </div>

        {/* Advanced Mint Form */}
        {showMintForm && (
          <div className="card bg-base-200 p-4 space-y-3">
            <div className="form-control">
              <label className="label">
                <span className="label-text text-sm">Mint to Address (optional)</span>
              </label>
              <input
                type="text"
                placeholder="Leave empty to mint to yourself"
                className="input input-bordered input-sm"
                value={mintToAddress}
                onChange={(e) => setMintToAddress(e.target.value)}
                disabled={isMintingTx}
              />
            </div>

            <div className="divider text-xs">Option 1: Use IPFS Hash</div>

            <div className="form-control">
              <label className="label">
                <span className="label-text text-sm">IPFS Hash</span>
              </label>
              <input
                type="text"
                placeholder="QmXxx... (IPFS hash of metadata)"
                className="input input-bordered input-sm"
                value={ipfsHash}
                onChange={(e) => setIpfsHash(e.target.value)}
                disabled={isMintingTx}
              />
            </div>

            <div className="divider text-xs">Option 2: Create Metadata</div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="form-control">
                <label className="label">
                  <span className="label-text text-sm">NFT Name</span>
                </label>
                <input
                  type="text"
                  placeholder="My Cool NFT"
                  className="input input-bordered input-sm"
                  value={nftName}
                  onChange={(e) => setNftName(e.target.value)}
                  disabled={isMintingTx || !!ipfsHash}
                />
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text text-sm">Image URL</span>
                </label>
                <input
                  type="text"
                  placeholder="https://... or ipfs://..."
                  className="input input-bordered input-sm"
                  value={nftImage}
                  onChange={(e) => setNftImage(e.target.value)}
                  disabled={isMintingTx || !!ipfsHash}
                />
              </div>
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text text-sm">Description</span>
              </label>
              <textarea
                placeholder="A unique and amazing NFT..."
                className="textarea textarea-bordered textarea-sm"
                value={nftDescription}
                onChange={(e) => setNftDescription(e.target.value)}
                disabled={isMintingTx || !!ipfsHash}
                rows={2}
              />
            </div>

            <button
              className="btn btn-secondary btn-sm"
              onClick={handleMintWithMetadata}
              disabled={isMintingTx || (!ipfsHash && !nftName && !nftDescription && !nftImage)}
            >
              {isMintingTx ? (
                <>
                  <span className="loading loading-spinner loading-xs"></span>
                  Minting...
                </>
              ) : (
                "Mint with Custom Data"
              )}
            </button>
          </div>
        )}
      </div>

      {/* NFTs Display Section */}
      <div className="divider">Your NFTs from this Contract</div>

      {collectiblesLoading ? (
        <div className="flex flex-col items-center justify-center py-8">
          <span className="loading loading-spinner loading-lg mb-4"></span>
          <div className="text-center">
            <div className="text-lg font-semibold mb-2">Loading your NFTs...</div>
            {loadingProgress.total > 0 && (
              <>
                <div className="text-sm text-gray-600 mb-2">
                  Processing {loadingProgress.current} of {loadingProgress.total} NFTs
                </div>
                <progress 
                  className="progress progress-primary w-64" 
                  value={loadingProgress.current} 
                  max={loadingProgress.total}
                ></progress>
              </>
            )}
            <div className="text-xs text-gray-500 mt-2">
              Using server-side IPFS fetching to avoid CORS issues...
            </div>
          </div>
        </div>
      ) : myCollectibles.length === 0 ? (
        <div className="flex justify-center items-center py-8">
          <div className="text-center">
            <div className="text-lg text-gray-600 mb-2">No NFTs found</div>
            <p className="text-sm text-gray-500">Mint your first NFT above!</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-4 justify-center">
          {myCollectibles.map((item) => (
            <div key={`${contract.address}-${item.id}`}>
              <NFTCard 
                nft={item}
                contract={contract} 
                setTransferTx={setTransferTx}
                abi={abi} 
              />   
            </div>
          ))}
        </div>
      )}
    </div>
  );
};