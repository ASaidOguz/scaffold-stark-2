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
              NFT Factory
            </span>
          </h1>
          <div className="flex flex-col items-center justify-center">
            <Image
              src="/nft-factory.png"
              width="727"
              height="231"
              alt="challenge banner"
              className="rounded-xl border-4 border-primary"
            />
            <div className="max-w-3xl">
              
              <p className="text-center text-lg">
                🌟 The final deliverable is an app that lets users purchase and
                transfer NFTs. Deploy your contracts to a testnet then build and
                upload your app to a public web server. Submit the url on{" "}
                <a
                  href="https://www.scaffoldstark.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Scaffoldstark.com
                </a>{" "}
                !
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Home;
