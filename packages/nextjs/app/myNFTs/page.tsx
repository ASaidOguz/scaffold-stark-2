"use client";

import type { NextPage } from "next";
import { useAccount } from "@starknet-react/core";
import { CustomConnectButton } from "~~/components/scaffold-stark/CustomConnectButton";
import { MyHoldings } from "~~/components/SimpleNFT/MyHoldings";
import { useScaffoldReadContract } from "~~/hooks/scaffold-stark/useScaffoldReadContract";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-stark/useScaffoldWriteContract";
import { notification } from "~~/utils/scaffold-stark";
import { addToIPFS } from "~~/utils/simpleNFT/ipfs-fetch";
import nftsMetadata from "~~/utils/simpleNFT/nftsMetadata";
import { useState } from "react";

const MyNFTs: NextPage = () => {
  const { address: connectedAddress, isConnected, isConnecting } = useAccount();
  const [status, setStatus] = useState("Deploy NFT Contract");
  const [isDeploying, setIsDeploying] = useState(false);
  const [lastMintedTokenId, setLastMintedTokenId] = useState<number>();
  // Need to set the arguments of deploy nft contract function
  // This elements will be accepted from pagetsx form element 
  // and passed to the deploy_nft_contract function
  // This way we will deploy new NFT contract via NFT Factory contract
  const { sendAsync: mintItem } = useScaffoldWriteContract({
    contractName: "NftFactory",
    functionName: "deploy_nft_contract",
    args: [connectedAddress, ""],
  });
  // This will read the number of deployed NFT contracts by the connected address
  // So we can map these addresses as individual deployed nft contracts
  // Users will be able to choose which NFT contract to mint from
  const { data: tokenIdCounter, refetch } = useScaffoldReadContract({
    contractName: "NftFactory",
    functionName: "get_deployed_nfts_by_deployer",
    args: [connectedAddress],
    watch: true,
  });

  const handleDeployContract = async () => {
    setStatus("Deploying NFT Contract");
    setIsDeploying(true);
    const tokenIdCounterNumber = Number(tokenIdCounter);

    // circle back to the zero item if we've reached the end of the array
    if (
      tokenIdCounter === undefined ||
      tokenIdCounterNumber === lastMintedTokenId
    ) {
      setStatus("Deploy NFT Contract");
      setIsDeploying(false);
      notification.warning(
        "Cannot mint the same token again, please wait for the new token ID",
      );
      return;
    }

    const currentTokenMetaData =
      nftsMetadata[tokenIdCounterNumber % nftsMetadata.length];
    const notificationId = notification.loading("Uploading to IPFS");
    try {
      const uploadedItem = await addToIPFS(currentTokenMetaData);

      // First remove previous loading notification and then show success notification
      notification.remove(notificationId);
      notification.success("Metadata uploaded to IPFS");

      await mintItem({
        args: [connectedAddress, uploadedItem.path],
      });
      setStatus("Updating NFT Contract List");
      refetch();
      console.log("Nft Contract Array:",tokenIdCounter)
      setLastMintedTokenId(tokenIdCounterNumber);
      setIsDeploying(false);
    } catch (error) {
      notification.remove(notificationId);
      console.error(error);
      setStatus("Deploy NFT Contract");
      setIsDeploying(false);
    }
  };

  return (
    <>
      <div className="flex items-center flex-col pt-10">
        <div className="px-5">
          <h1 className="text-center mb-8">
            <span className="block text-4xl font-bold">Nft Factory</span>
          </h1>
        </div>
      </div>
      <div className="flex justify-center">
        {!isConnected || isConnecting ? (
          <CustomConnectButton />
        ) : (
          <button
            className="btn btn-secondary text-white"
            disabled={status !== "Deploy NFT Contract" || isDeploying}
            onClick={handleDeployContract}
          >
            {status !== "Deploy NFT Contract" && (
              <span className="loading loading-spinner loading-xs"></span>
            )}
            {status}
          </button>
        )}
      </div>
      <MyHoldings setStatus={setStatus} />
    </>
  );
};

export default MyNFTs;
