
use starknet::{ContractAddress, get_caller_address, 
                ClassHash, syscalls::deploy_syscall};
use starknet::SyscallResultTrait;

use core::byte_array::ByteArray;
use core::felt252;
use core::serde::Serde; 
#[starknet::interface]
pub trait INftFactory<TContractState> {
    fn deploy_nft_contract(ref self: TContractState,   
                               contract_name:ByteArray,
                               symbol:ByteArray) -> ContractAddress;
    fn set_nft_class_hash(ref self: TContractState, new_class_hash: ClassHash);
    fn get_nft_class_hash(self: @TContractState) -> ClassHash;
    fn get_deployed_nfts_by_deployer(self: @TContractState, 
                                     deployer: ContractAddress) -> Array<ContractAddress>;
}

#[starknet::contract]
pub mod NftFactory {
    use openzeppelin_access::ownable::OwnableComponent;
    use starknet::storage::{Map, StorageMapReadAccess, 
                            StoragePathEntry, StoragePointerReadAccess,StoragePointerWriteAccess};
    
    use super::*;
    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    
    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        NftClassHashChange: NftClassHashChange,
        NftContractDeployed: NftContractDeployed,
    }

    #[derive(Drop, starknet::Event)]
    struct NftClassHashChange {
        #[key]
        old_nft_classhash: ClassHash,
        #[key]
        new_nft_classhash: ClassHash,
    }

    #[derive(Drop, starknet::Event)]
    struct NftContractDeployed {
        #[key]
        nft_classhash: ClassHash,
        #[key]
        contract_address: ContractAddress,
        deployer_address:ContractAddress,
    }

    #[storage]
    struct Storage {
        /// Store the class hash of the SimpleCollectible contract to deploy
        nft_class_hash: ClassHash,
        deployed_collections_by_deployer: Map<ContractAddress,Map<u64, ContractAddress>>,
        deployed_collection_count_by_deployer: Map<ContractAddress, u64>,
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, nft_class_hash: ClassHash) {
        self.nft_class_hash.write(nft_class_hash);
        self.ownable.initializer(owner);
    }

    #[abi(embed_v0)]
    impl NftFactoryImpl of INftFactory<ContractState> {
        fn deploy_nft_contract(ref self: ContractState,
                               contract_name:ByteArray,
                               symbol:ByteArray)-> ContractAddress{
 
        // 1. lets create salt so we wont try to deploy same contract again 
            let deployer = get_caller_address();
            let count = self.deployed_collection_count_by_deployer.read(deployer);
            // Write the deployed contract address to the storage

        // 2. Prepare the calldata for the deploy_syscall
        let mut serialized_data: Array<felt252> = array![];
       
        deployer.serialize(ref serialized_data);
        contract_name.serialize(ref serialized_data);
        symbol.serialize(ref serialized_data);
        let class_hash_constant = self.nft_class_hash.read();

        let (deployed_address,_) = deploy_syscall(
             class_hash_constant,
             count.into(), // salt
             serialized_data.span(),
             false, // deploy_from_zero
            ).unwrap_syscall();

            self.deployed_collections_by_deployer.entry(deployer).entry(count).write(deployed_address);
            // Increment the count for this deployer
            self.deployed_collection_count_by_deployer.entry(deployer).write(count + 1);

            // Emit event after successful deployment
            self.emit(NftContractDeployed {
                nft_classhash: class_hash_constant,
                contract_address: deployed_address,
                deployer_address: deployer,
            });
            // Return the deployed contract address
            deployed_address

        }

        fn set_nft_class_hash(ref self: ContractState,new_class_hash: ClassHash) {
           self.ownable.assert_only_owner();
            // Emit event before changing the class hash   
           self.emit(NftClassHashChange {
                old_nft_classhash: self.nft_class_hash.read(),
                new_nft_classhash: new_class_hash,
            });
            self.nft_class_hash.write(new_class_hash);
        }
  
        fn get_nft_class_hash(self: @ContractState) -> ClassHash {
            self.nft_class_hash.read()
        }

        fn get_deployed_nfts_by_deployer(self: @ContractState, 
                                     deployer: ContractAddress) -> Array<ContractAddress>{
             // Get the count of deployed contracts for this deployer
            let count = self.deployed_collection_count_by_deployer.entry(deployer).read();
            
            if count == 0 {
                return array![];
            }

            // Create array and populate it with all deployed contract addresses
            let mut result: Array<ContractAddress> = array![];
            let mut i = 0;
            
            while i != count {
                let deployed_address = self.deployed_collections_by_deployer.entry(deployer).entry(i).read();
                result.append(deployed_address);
                i += 1;
            };

            result
                          }
                    }
    }
