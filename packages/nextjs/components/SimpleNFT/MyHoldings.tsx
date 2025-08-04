"use client";

import { Dispatch, SetStateAction, useEffect, useState, useCallback, useRef } from "react";
import { NFTCard } from "./NFTcard";
import { useAccount, useProvider, useConnect } from "@starknet-react/core";
import { Contract } from "starknet";
import { notification } from "~~/utils/scaffold-stark";
import { getMetadataFromIPFS, addToIPFS } from "~~/utils/simpleNFT/ipfs-fetch";
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
  const { provider } = useProvider(); // Destructure provider properly
  
  const [myCollectibles, setMyCollectibles] = useState<Collectible[]>([]);
  const [collectiblesLoading, setCollectiblesLoading] = useState(false);
  const [showMintForm, setShowMintForm] = useState(false);
  const [userBalance, setUserBalance] = useState(0);
  
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
  // use txhash as state change element - it will wait for the txhash to change
  // to trigger the effect
  const [txHash, settxHash] = useState<string | undefined>(undefined);
  // Update refs when props change
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

  // FIXED VERSION - Minimal dependencies, use refs for the rest
  useEffect(() => {
    const updateMyCollectibles = async (): Promise<void> => {
      console.log("🔄 Starting collectibles fetch...");
      
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

      try {
        const currentContract = contractRef.current;
        const currentAbi = abiRef.current;
        
        const addressString = ensureAddressString(currentContract.address);
        const nftContract = new Contract(currentAbi, addressString, provider || provider);
      
        const [ totalSupplyResult] = await Promise.all([nftContract.call("total_supply")]);
        contract.totalSupply = Number(totalSupplyResult);
        
        console.log("📞 Fetching balance...");
        const balance = await nftContract.call("balance_of", [connectedAddress]);
        const userBalanceValue = Number(Array.isArray(balance) ? balance[0] : balance);
        
        console.log("✅ Balance:", userBalanceValue);
        setUserBalance(userBalanceValue);

        if (userBalanceValue === 0) {
          console.log("⚪ Zero balance");
          setMyCollectibles([]);
          return;
        }

        // Create collectibles array
        const collectibles: Collectible[] = [];
        
        for (let i = 0; i < userBalanceValue; i++) {
          try {
            console.log(`📋 Processing ${i}/${userBalanceValue - 1}`);
            
            const tokenIdResponse = await nftContract.call("token_of_owner_by_index", [connectedAddress, i]);
            const tokenId = Number(Array.isArray(tokenIdResponse) ? tokenIdResponse[0] : tokenIdResponse);
            
            const tokenURIResponse = await nftContract.call("token_uri", [tokenId]);
            const tokenURI = Array.isArray(tokenURIResponse) ? tokenURIResponse.join("") : String(tokenURIResponse);
            
            let metadata: NFTMetaData = {
              description: "",
              external_url: "",
              image: "",
              name: `Token #${tokenId}`,
              attributes: [],
            };

            // Try to fetch metadata with timeout
            if (tokenURI && tokenURI.includes("ipfs")) {
              try {
                const ipfsHash = tokenURI.replace(/https:\/\/ipfs\.io\/(ipfs\/)?/, "");
                console.log(`🌐 Fetching IPFS metadata for token ${tokenId}...`);
                
                const metadataPromise = getMetadataFromIPFS(ipfsHash);
                const timeoutPromise = new Promise((_, reject) => 
                  setTimeout(() => reject(new Error('IPFS timeout')), 5000) // Reduced timeout
                );
                
                metadata = await Promise.race([metadataPromise, timeoutPromise]) as NFTMetaData;
                console.log(`✅ IPFS metadata fetched for token ${tokenId}`);
              } catch (metadataError) {
                console.warn(`⚠️ Could not fetch metadata for token ${tokenId}:`, metadataError);
              }
            }
            
            const finalImage = metadata.image || `https://via.placeholder.com/300?text=NFT+${tokenId}`;
            
            collectibles.push({
              id: tokenId,
              uri: tokenURI,
              owner: connectedAddress,
              name: metadata.name || `Token #${tokenId}`,
              description: metadata.description || `NFT Token #${tokenId}`,
              image: finalImage,
              attributes: metadata.attributes || [],
            });
            
            console.log(`✅ Token ${tokenId} added (${i + 1}/${userBalanceValue})`);
          } catch (tokenError) {
            console.error(`Error processing token ${i}:`, tokenError);
            // Continue with next token instead of breaking
          }
        }

        console.log("🎉 Setting collectibles:", collectibles.length);
        console.log("Collectibles data:", collectibles);
        setMyCollectibles(collectibles);
        
      } catch (error) {
        console.error("💥 Error:", error);
        setMyCollectibles([]);
        notification.error("Error fetching NFTs for this contract");
      } finally {
        console.log("🏁 Setting loading to false");
        setCollectiblesLoading(false);
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
  }, [connectedAddress, provider, contract.address, refreshTrigger,txHash]);

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
          finalIpfsHash = uploadedItem.IpfsHash;
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
       if (response) {
        const txRecipt=await provider.waitForTransaction(response);
        console.log("Transaction receipt:", txRecipt);
        const result=txRecipt.isSuccess();
        if (result){
        settxHash(response);}else{
          notification.error("NFT minting failed");
        }
      }
      notification.remove(mintNotification);

      if (response) {
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
        args: [connectedAddress, "QmVsC32PYDe1cM9zoA8JMninKjeFmHB4xRXi1As2vrv5or"],
      });
         if (response) {
        const txRecipt=await provider.waitForTransaction(response);
        console.log("Transaction receipt:", txRecipt);
        const result=txRecipt.isSuccess();
        if (result){
        settxHash(response);}else{
          notification.error("NFT minting failed");
        }
      }

      notification.remove(mintNotification);

      if (response) {
        notification.success(`NFT minted successfully! Tx Hash: ${response}`, { duration: 8000 });
        
        triggerRefresh();
        if (onRefreshRef.current) onRefreshRef.current();
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
        <div className="flex justify-center items-center py-8">
          <div className="text-center">
            <span className="loading loading-spinner loading-lg"></span>
            <p className="text-sm text-gray-500 mt-2">Loading your NFTs...</p>
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

              <div>
                <NFTCard nft={item}
                         contract={contract} 
                         abi={abi} 
                         key={`${contract.address}-${item.id}`} />
              
            </div>
            /* Replace with: <NFTCard nft={item} key={`${contract.address}-${item.id}`} /> */
          ))}
        </div>
      )}
    </div>
  );
};