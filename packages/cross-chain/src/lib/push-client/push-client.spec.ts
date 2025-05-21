import { PushClient } from './push-client';
import { getContractAddress, toBytes } from 'viem';
import { CHAIN_INFO } from '../constants/chain';
import {
  MsgDeployNMSC,
  MsgMintPush,
  MsgExecutePayload,
} from '../generated/v1/tx';
import { TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { NETWORK } from '../constants/enums';

// These constants must match what your PushClient uses internally
const FACTORY_ADDRESS: `0x${string}` =
  '0x0000000000000000000000000000000000000000';
const SC_WALLET_BYTECODE: `0x${string}` = '0x00'; // dummy bytecode for test
const EVM_RPC_URL = CHAIN_INFO['PUSH_TESTNET'].defaultRPC;

describe('PushClient', () => {
  let client: PushClient;

  beforeEach(() => {
    client = new PushClient({
      rpcUrl: EVM_RPC_URL,
      network: NETWORK.TESTNET,
    });
  });

  describe('pushToUSDC', () => {
    it('converts 1 PUSH (1e18) to 0.1 USDC (1e7)', () => {
      const result = client.pushToUSDC(BigInt('1000000000000000000'));
      expect(result).toBe(BigInt(10000000));
    });

    it('returns 0 when input is 0', () => {
      expect(client.pushToUSDC(BigInt(0))).toBe(BigInt(0));
    });
  });

  describe('usdcToPush', () => {
    it('converts 0.1 USDC (1e7) to 1 PUSH (1e18)', () => {
      const result = client.usdcToPush(BigInt(10000000));
      expect(result).toBe(BigInt('1000000000000000000'));
    });

    it('returns 0 when input is 0', () => {
      expect(client.usdcToPush(BigInt(0))).toBe(BigInt(0));
    });
  });

  describe('PushClient Msg & Cosmos Tx Tests', () => {
    it('creates MsgDeployNMSC Any', () => {
      const msg: MsgDeployNMSC = {
        signer: 'push1f5th78lzntc2h0krzqn5yldvwg43lcrgkqxtsv',
        userKey: '0x778D3206374f8AC265728E18E3fE2Ae6b93E4ce4',
        caipString: 'eip155:1:0x778D3206374f8AC265728E18E3fE2Ae6b93E4ce4',
        ownerType: 1,
      };

      const any = client.createMsgDeployNMSC(msg);
      expect(any.typeUrl).toBe('/crosschain.v1.MsgDeployNMSC');
      expect(any.value.length).toBeGreaterThan(0);
    });

    it('creates MsgMintPush Any', () => {
      const msg: MsgMintPush = {
        signer: 'push1f5th78lzntc2h0krzqn5yldvwg43lcrgkqxtsv',
        txHash: '0x',
        caipString: 'eip155:1:0x35B84d6848D16415177c64D64504663b998A6ab4',
      };

      const any = client.createMsgMintPush(msg);
      expect(any.typeUrl).toBe('/crosschain.v1.MsgMintPush');
      expect(any.value.length).toBeGreaterThan(0);
    });

    it('creates MsgExecutePayload Any', () => {
      const msg: MsgExecutePayload = {
        signer: 'push1f5th78lzntc2h0krzqn5yldvwg43lcrgkqxtsv',
        caipString:
          'sol:abccd:0x30ea71869947818d27b718592ea44010b458903bd9bf0370f50eda79e87d9f69',
        crosschainPayload: {
          target: '0x527F3692F5C53CfA83F7689885995606F93b6164',
          value: '0',
          data: '0x2ba2ed980000000000000000000000000000000000000000000000000000000000000312',
          gasLimit: '21000000',
          maxFeePerGas: '1000000000',
          maxPriorityFeePerGas: '200000000',
          nonce: '1',
          deadline: '9999999999',
        },
        signature:
          '0x911d4ee13db2ca041e52c0e77035e4c7c82705a77e59368740ef42edcdb813144aff65d2a3a6d03215f764a037a229170c69ffbaaad50fff690940a5ef458304',
      };

      const any = client.createMsgExecutePayload(msg);
      expect(any.typeUrl).toBe('/crosschain.v1.MsgExecutePayload');
      expect(any.value.length).toBeGreaterThan(0);
    });

    it('creates TxBody from multiple messages', async () => {
      const msg1 = client.createMsgDeployNMSC({
        signer: 'push1f5th78lzntc2h0krzqn5yldvwg43lcrgkqxtsv',
        userKey: '0x778D3206374f8AC265728E18E3fE2Ae6b93E4ce4',
        caipString: 'eip155:1:0x778D3206374f8AC265728E18E3fE2Ae6b93E4ce4',
        ownerType: 1,
      });

      const msg2 = client.createMsgMintPush({
        signer: 'push1f5th78lzntc2h0krzqn5yldvwg43lcrgkqxtsv',
        txHash: '0x',
        caipString: 'eip155:1:0x35B84d6848D16415177c64D64504663b998A6ab4',
      });

      const txBody = await client.createCosmosTxBody([msg1, msg2], 'test memo');
      expect(txBody.messages.length).toBe(2);
      expect(txBody.memo).toBe('test memo');
    });

    it('signs and broadcasts a tx (live node)', async () => {
      const msg1 = client.createMsgDeployNMSC({
        signer: 'push1f5th78lzntc2h0krzqn5yldvwg43lcrgkqxtsv',
        userKey: '0x778D3206374f8AC265728E18E3fE2Ae6b93E4ce4',
        caipString: 'eip155:1:0x778D3206374f8AC265728E18E3fE2Ae6b93E4ce4',
        ownerType: 1,
      });

      const msg2 = client.createMsgMintPush({
        signer: 'push1f5th78lzntc2h0krzqn5yldvwg43lcrgkqxtsv',
        txHash: '0x',
        caipString: 'eip155:1:0x35B84d6848D16415177c64D64504663b998A6ab4',
      });

      const msg3 = client.createMsgExecutePayload({
        signer: 'push1f5th78lzntc2h0krzqn5yldvwg43lcrgkqxtsv',
        caipString:
          'sol:abccd:0x30ea71869947818d27b718592ea44010b458903bd9bf0370f50eda79e87d9f69',
        crosschainPayload: {
          target: '0x527F3692F5C53CfA83F7689885995606F93b6164',
          value: '0',
          data: '0x2ba2ed980000000000000000000000000000000000000000000000000000000000000312',
          gasLimit: '21000000',
          maxFeePerGas: '1000000000',
          maxPriorityFeePerGas: '200000000',
          nonce: '1',
          deadline: '9999999999',
        },
        signature:
          '0x911d4ee13db2ca041e52c0e77035e4c7c82705a77e59368740ef42edcdb813144aff65d2a3a6d03215f764a037a229170c69ffbaaad50fff690940a5ef458304',
      });

      const txBody = await client.createCosmosTxBody([msg1, msg2, msg3]);
      const txRaw: TxRaw = await client.signCosmosTx(txBody);
      const txHash = await client.broadcastCosmosTx(txRaw);

      console.log('✅ TxHash:', txHash);
      expect(txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    }, 20000);
  });
});
