import { useCallback } from "react";
import { useTargetNetwork } from "./useTargetNetwork";
import {
  useDeployedContractInfo,
  useTransactor,
} from "~~/hooks/scaffold-stark";
import {
  ContractAbi,
  ContractName,
  ExtractAbiFunctionNamesScaffold,
  UseScaffoldWriteConfig,
} from "~~/utils/scaffold-stark/contract";
import { useSendTransaction, useNetwork, Abi } from "@starknet-react/core";
import { notification } from "~~/utils/scaffold-stark";
import { Contract as StarknetJsContract } from "starknet";

// Extended config type that supports both static and dynamic contracts
export type DynamicScaffoldWriteConfig<
  TAbi extends Abi,
  TContractName extends ContractName,
  TFunctionName extends ExtractAbiFunctionNamesScaffold<
    ContractAbi<TContractName>,
    "external"
  >,
> = UseScaffoldWriteConfig<TAbi, TContractName, TFunctionName> & {
  // For dynamically deployed contracts
  contractAddress?: string;
  contractAbi?: Abi;
  // Set to true to skip deployed contract lookup
  isDynamic?: boolean;
};

export const useScaffoldWriteContract = <
  TAbi extends Abi,
  TContractName extends ContractName,
  TFunctionName extends ExtractAbiFunctionNamesScaffold<
    ContractAbi<TContractName>,
    "external"
  >,
>({
  contractName,
  functionName,
  args,
  contractAddress,
  contractAbi,
  isDynamic = false,
}: DynamicScaffoldWriteConfig<TAbi, TContractName, TFunctionName>) => {
  // Always call the hook but conditionally use the result
  const { data: staticContractData } = useDeployedContractInfo(contractName);
  const deployedContractData = isDynamic ? undefined : staticContractData;
  
  const { chain } = useNetwork();
  const { writeTransaction: sendTxnWrapper, sendTransactionInstance } =
    useTransactor();
  const { targetNetwork } = useTargetNetwork();

  const sendContractWriteTx = useCallback(
    async (params?: {
      args?: DynamicScaffoldWriteConfig<TAbi, TContractName, TFunctionName>["args"];
    }) => {
      // if no args supplied, use the one supplied from hook
      let newArgs = params?.args;
      if (Object.keys(newArgs || {}).length <= 0) {
        newArgs = args;
      }

      // Determine contract data source
      let contractData;
      if (isDynamic) {
        if (!contractAddress || !contractAbi) {
          console.error(
            "Dynamic contract requires both contractAddress and contractAbi"
          );
          return;
        }
        contractData = {
          address: contractAddress,
          abi: contractAbi,
        };
      } else {
        if (!deployedContractData) {
          console.error(
            "Target Contract is not deployed, did you forget to run `yarn deploy`?"
          );
          return;
        }
        contractData = deployedContractData;
      }

      if (!chain?.id) {
        console.error("Please connect your wallet");
        return;
      }
      if (chain?.id !== targetNetwork.id) {
        console.error("You are on the wrong network");
        return;
      }

      // Create contract instance
      const contractInstance = new StarknetJsContract(
        contractData.abi,
        contractData.address
      );

      const newCalls = [contractInstance.populate(functionName, newArgs as any[])];

      try {
        return await sendTxnWrapper(newCalls as any[]);
      } catch (e: any) {
        throw e;
      }
    },
    [
      args,
      chain?.id,
      deployedContractData,
      contractAddress,
      contractAbi,
      isDynamic,
      functionName,
      sendTransactionInstance,
      sendTxnWrapper,
      targetNetwork.id,
    ]
  );

  return {
    ...sendTransactionInstance,
    sendAsync: sendContractWriteTx,
  };
};

// Alternative: Separate hook specifically for dynamic contracts
export const useDynamicScaffoldWriteContract = (config: {
  contractAddress: string;
  contractAbi: Abi;
  functionName: string;
  args?: any[];
}) => {
  const { chain } = useNetwork();
  const { writeTransaction: sendTxnWrapper, sendTransactionInstance } =
    useTransactor();
  const { targetNetwork } = useTargetNetwork();

  const sendContractWriteTx = useCallback(
    async (params?: { args?: any[] }) => {
      const newArgs = params?.args || config.args || [];

      if (!config.contractAddress || !config.contractAbi) {
        console.error("Contract address and ABI are required");
        return;
      }

      if (!chain?.id) {
        console.error("Please connect your wallet");
        return;
      }
      if (chain?.id !== targetNetwork.id) {
        console.error("You are on the wrong network");
        return;
      }

      const contractInstance = new StarknetJsContract(
        config.contractAbi,
        config.contractAddress
      );

      const newCalls = [contractInstance.populate(config.functionName, newArgs)];

      try {
        return await sendTxnWrapper(newCalls);
      } catch (e: any) {
        throw e;
      }
    },
    [
      config.contractAddress,
      config.contractAbi,
      config.functionName,
      config.args,
      chain?.id,
      sendTxnWrapper,
      targetNetwork.id,
    ]
  );

  return {
    ...sendTransactionInstance,
    sendAsync: sendContractWriteTx,
  };
};