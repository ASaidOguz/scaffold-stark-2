"use client";

import type { NextPage } from "next";
import { useAccount, useProvider } from "@starknet-react/core";
import { CustomConnectButton } from "~~/components/scaffold-stark/CustomConnectButton";
import { MyHoldings } from "~~/components/SimpleNFT/MyHoldings";
import { useScaffoldReadContract } from "~~/hooks/scaffold-stark/useScaffoldReadContract";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-stark/useScaffoldWriteContract";
import { notification } from "~~/utils/scaffold-stark";
import { useState, useEffect, useMemo, useCallback } from "react";
import { Contract,waitForTransactionOptions } from "starknet";
import{Abi as SIMPLE_NFT_ABI} from "./abi"; // Import the ABI from the abi.ts file


export interface ContractData {
  address: string;
  name: string;
  symbol: string;
  totalSupply: number;
}

const NftFactory: NextPage = () => {
  const { address: connectedAddress, isConnected, isConnecting, account } = useAccount();
  const { provider } = useProvider();
  const [status, setStatus] = useState("Deploy NFT Contract");
  const [isDeploying, setIsDeploying] = useState(false);
  const [contractArray, setContractArray] = useState<ContractData[]>([]);
  const [isLoadingContracts, setIsLoadingContracts] = useState(false);
  const [txHash, settxHash] = useState<string | undefined>(undefined);
  // Form state for contract deployment parameters
  const [contractName, setContractName] = useState("");
  const [contractSymbol, setContractSymbol] = useState("");
   
  const memoizedAbi = useMemo(() => SIMPLE_NFT_ABI, []);
  // Deploy contract function
  const { sendAsync: deployContract } = useScaffoldWriteContract({
    contractName: "NftFactory",
    functionName: "deploy_nft_contract",
    args: [contractName, contractSymbol],
  });

  // Get deployed contract addresses
  const { data: deployedAddresses, refetch: refetchAddresses } = useScaffoldReadContract({
    contractName: "NftFactory",
    functionName: "get_deployed_nfts_by_deployer",
    args: [connectedAddress],
    watch: false,
  });

  // Fetch contract details and build contract array
useEffect(() => {
  const fetchContractArray = async () => {
    if (!connectedAddress || !provider) {
      setContractArray([]);
      return;
    }

    setIsLoadingContracts(true);
    setContractArray([]); // Clear previous data early

    try {
      const freshAddresses = await refetchAddresses(); // manually fetch fresh data

      const rawAddresses = freshAddresses?.data;

      if (!rawAddresses || !Array.isArray(rawAddresses)) {
        setContractArray([]);
        setIsLoadingContracts(false);
        return;
      }

      const contracts: ContractData[] = [];

      for (const address of rawAddresses) {
        try {
          const addressString =
            typeof address === "bigint" || typeof address === "number"
              ? `0x${address.toString(16)}`
              : address;

          const nftContract = new Contract(SIMPLE_NFT_ABI, addressString, provider);
          const [nameResult, symbolResult, totalSupplyResult] = await Promise.all([
            nftContract.call("name"),
            nftContract.call("symbol"),
            nftContract.call("total_supply"),
          ]);

          contracts.push({
            address: addressString,
            name: nameResult.toString(),
            symbol: symbolResult.toString(),
            totalSupply: Number(totalSupplyResult),
          });
        } catch (error) {
          console.error(`Error reading contract at ${address}:`, error);
          const addressString =
            typeof address === "bigint" || typeof address === "number"
              ? `0x${address.toString(16)}`
              : address;

          contracts.push({
            address: addressString,
            name: "Unknown Contract",
            symbol: "UNK",
            totalSupply: 0,
          });
        }
      }

      setContractArray(contracts);
    } catch (err) {
      console.error("Error fetching contract addresses:", err);
      setContractArray([]);
    } finally {
      setIsLoadingContracts(false);
    }
  };

  fetchContractArray();
}, [connectedAddress, isConnected, provider,txHash]);



  const handleDeployContract = async () => {
    if (!contractName.trim()) {
      notification.error("Contract name is required");
      return;
    }
    if (!contractSymbol.trim()) {
      notification.error("Contract symbol is required");
      return;
    }

    setStatus("Deploying NFT Contract");
    setIsDeploying(true);
    
    try {
      const response = await deployContract({
        args: [contractName, contractSymbol],
      });
      console.log("Deploy response:", response);
      setStatus("Updating NFT Contract List");
      await refetchAddresses();
      setIsDeploying(false);
      
      // Reset form after successful deployment
      setContractName("");
      setContractSymbol("");
      if (response) {
        const txRecipt=await provider.waitForTransaction(response);
        console.log("Transaction receipt:", txRecipt);
        const result=txRecipt.isSuccess();
        if (result){
          setStatus("Deploy NFT Contract");
        notification.success("NFT Contract deployed successfully!");
        settxHash(response);}else{
          notification.error("NFT Contract deployment failed");
        }
      }
    } catch (error) {
      console.error(error);
      setStatus("Deploy NFT Contract");
      setIsDeploying(false);
      notification.error("Failed to deploy contract");
    }
  };

  // Memoize the refresh function to prevent recreating on every render
const refreshContractArray = useCallback(() => {
  refetchAddresses();
}, [refetchAddresses,connectedAddress]);

  return (
    <>
      <div className="flex items-center flex-col pt-10">
        <div className="px-5">
          <h1 className="text-center mb-8">
            <span className="block text-4xl font-bold">NFT Factory</span>
          </h1>
        </div>
      </div>

      {!isConnected || isConnecting ? (
        <div className="flex justify-center">
          <CustomConnectButton />
        </div>
      ) : (
        <div className="flex flex-col items-center">
          {/* Deploy New Contract Section */}
          <div className="card w-96 bg-base-100 shadow-xl mb-8">
            <div className="card-body">
              <h2 className="card-title justify-center mb-4">Deploy New NFT Contract</h2>
              
              <div className="form-control w-full">
                <label className="label">
                  <span className="label-text">Contract Name *</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g., My Awesome NFTs"
                  className="input input-bordered w-full"
                  value={contractName}
                  onChange={(e) => setContractName(e.target.value)}
                  disabled={isDeploying}
                />
              </div>

              <div className="form-control w-full">
                <label className="label">
                  <span className="label-text">Contract Symbol *</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g., MAN"
                  className="input input-bordered w-full"
                  value={contractSymbol}
                  onChange={(e) => setContractSymbol(e.target.value.toUpperCase())}
                  disabled={isDeploying}
                />
              </div>

              <button
                className="btn btn-primary mt-4"
                disabled={status !== "Deploy NFT Contract" || isDeploying || !contractName.trim() || !contractSymbol.trim()}
                onClick={handleDeployContract}
              >
                {isDeploying && <span className="loading loading-spinner loading-xs"></span>}
                {status}
              </button>
            </div>
          </div>

          {/* Loading State */}
          {isLoadingContracts && (
            <div className="flex justify-center items-center">
              <span className="loading loading-spinner loading-lg"></span>
              <span className="ml-3">Loading your contracts...</span>
            </div>
          )}

          {/* No Contracts State */}
          {!isLoadingContracts && contractArray.length === 0 && (
            <div className="text-center">
              <div className="text-xl text-gray-600 mb-4">No NFT contracts deployed yet</div>
              <p className="text-gray-500">Deploy your first contract above to get started!</p>
            </div>
          )}

          {/* Contract Array Mapping */}
          {!isLoadingContracts && contractArray.length > 0 && (
            <div className="w-full max-w-7xl">
              <div className="flex justify-between items-center mb-6 px-4">
                <h2 className="text-2xl font-bold">Your NFT Contracts ({contractArray.length})</h2>
                <button 
                  className="btn btn-outline btn-sm"
                  onClick={refreshContractArray}
                >
                  Refresh All
                </button>
              </div>
              
              <div className="space-y-8">
                {contractArray.map((contract) => (
                  <div key={contract.address} className="border-2 border-base-300 rounded-lg p-6 bg-base-50">
                     { <MyHoldings 
                      contract={contract}
                      abi={memoizedAbi}
                      onRefresh={refreshContractArray}
                    />}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default NftFactory;

