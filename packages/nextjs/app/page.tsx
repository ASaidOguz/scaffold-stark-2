"use client";

import type { NextPage } from "next";
import Image from "next/image";

const Home: NextPage = () => {
  return (
    <>
      <div className="flex items-center flex-col flex-grow pt-10">
        <div className="px-5 w-[90%] md:w-[75%]">
          <h1 className="text-center mb-6">
            <span className="block text-2xl mb-2">NFT-FACTORY</span>
            <span className="block text-4xl font-bold">
              Wellcome to Nft Factory 
            </span>
          </h1>
          <div className="flex flex-col items-center justify-center">
        
            <div className="max-w-3xl">
              
              <p className="text-center text-lg">
                🌟 In Nft factory website where you can easily create your nft contract and 
                deploy on starknet sepolia testnet.And then enjoy minting your nfts to friends and family.
                🌟 IPFS Upload : This section where you can create and upload your nft metadata.
                🌟 IPFS Download : This section where you can check your nft metada via ipfs hash by downloading it.
              </p>
                  <Image
              src="/nft-factory.png"
              width="727"
              height="231"
              alt="challenge banner"
              className="rounded-xl border-4 border-primary"
            />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Home;
