// Code generated by protoc-gen-ts_proto. DO NOT EDIT.
// versions:
//   protoc-gen-ts_proto  v2.7.0
//   protoc               v3.20.3
// source: v1/tx.proto

/* eslint-disable */
import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";

export const protobufPackage = "ue.v1";

export enum vmType {
  EVM = 0,
  SVM = 1,
  MOVE_VM = 2,
  WASM_VM = 3,
  CAIRO_VM = 4,
  OTHER_VM = 5,
  UNRECOGNIZED = -1,
}

export function vmTypeFromJSON(object: any): vmType {
  switch (object) {
    case 0:
    case "EVM":
      return vmType.EVM;
    case 1:
    case "SVM":
      return vmType.SVM;
    case 2:
    case "MOVE_VM":
      return vmType.MOVE_VM;
    case 3:
    case "WASM_VM":
      return vmType.WASM_VM;
    case 4:
    case "CAIRO_VM":
      return vmType.CAIRO_VM;
    case 5:
    case "OTHER_VM":
      return vmType.OTHER_VM;
    case -1:
    case "UNRECOGNIZED":
    default:
      return vmType.UNRECOGNIZED;
  }
}

export function vmTypeToJSON(object: vmType): string {
  switch (object) {
    case vmType.EVM:
      return "EVM";
    case vmType.SVM:
      return "SVM";
    case vmType.MOVE_VM:
      return "MOVE_VM";
    case vmType.WASM_VM:
      return "WASM_VM";
    case vmType.CAIRO_VM:
      return "CAIRO_VM";
    case vmType.OTHER_VM:
      return "OTHER_VM";
    case vmType.UNRECOGNIZED:
    default:
      return "UNRECOGNIZED";
  }
}

/** AccountId is the identifier of a crosschain owner account */
export interface AccountId {
  namespace: string;
  chainId: string;
  ownerKey: string;
  vmType: vmType;
}

export interface MsgDeployNMSC {
  signer: string;
  accountId: AccountId | undefined;
  txHash: string;
}

export interface MsgMintPush {
  signer: string;
  /** account_id is the identifier of the crosschain owner account */
  accountId:
    | AccountId
    | undefined;
  /** tx_hash is the hash of the transaction in which user locked the tokens */
  txHash: string;
}

export interface CrossChainPayload {
  /** EVM address as hex string (0x...) */
  target: string;
  /** Amount in wei as string (uint256) */
  value: string;
  /** ABI-encoded calldata */
  data: string;
  /** uint256 as string */
  gasLimit: string;
  /** uint256 as string */
  maxFeePerGas: string;
  /** uint256 as string */
  maxPriorityFeePerGas: string;
  /** uint256 as string */
  nonce: string;
  /** uint256 as string */
  deadline: string;
}

export interface MsgExecutePayload {
  signer: string;
  /** account_id is the identifier of the crosschain owner account */
  accountId:
    | AccountId
    | undefined;
  /** payload is the crosschain payload to be executed */
  crosschainPayload:
    | CrossChainPayload
    | undefined;
  /** signature is the signature of the payload by user */
  signature: string;
}

function createBaseAccountId(): AccountId {
  return { namespace: "", chainId: "", ownerKey: "", vmType: 0 };
}

export const AccountId: MessageFns<AccountId> = {
  encode(message: AccountId, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.namespace !== "") {
      writer.uint32(10).string(message.namespace);
    }
    if (message.chainId !== "") {
      writer.uint32(18).string(message.chainId);
    }
    if (message.ownerKey !== "") {
      writer.uint32(26).string(message.ownerKey);
    }
    if (message.vmType !== 0) {
      writer.uint32(32).int32(message.vmType);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): AccountId {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseAccountId();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }

          message.namespace = reader.string();
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }

          message.chainId = reader.string();
          continue;
        }
        case 3: {
          if (tag !== 26) {
            break;
          }

          message.ownerKey = reader.string();
          continue;
        }
        case 4: {
          if (tag !== 32) {
            break;
          }

          message.vmType = reader.int32() as any;
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): AccountId {
    return {
      namespace: isSet(object.namespace) ? globalThis.String(object.namespace) : "",
      chainId: isSet(object.chainId) ? globalThis.String(object.chainId) : "",
      ownerKey: isSet(object.ownerKey) ? globalThis.String(object.ownerKey) : "",
      vmType: isSet(object.vmType) ? vmTypeFromJSON(object.vmType) : 0,
    };
  },

  toJSON(message: AccountId): unknown {
    const obj: any = {};
    if (message.namespace !== "") {
      obj.namespace = message.namespace;
    }
    if (message.chainId !== "") {
      obj.chainId = message.chainId;
    }
    if (message.ownerKey !== "") {
      obj.ownerKey = message.ownerKey;
    }
    if (message.vmType !== 0) {
      obj.vmType = vmTypeToJSON(message.vmType);
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<AccountId>, I>>(base?: I): AccountId {
    return AccountId.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<AccountId>, I>>(object: I): AccountId {
    const message = createBaseAccountId();
    message.namespace = object.namespace ?? "";
    message.chainId = object.chainId ?? "";
    message.ownerKey = object.ownerKey ?? "";
    message.vmType = object.vmType ?? 0;
    return message;
  },
};

function createBaseMsgDeployNMSC(): MsgDeployNMSC {
  return { signer: "", accountId: undefined, txHash: "" };
}

export const MsgDeployNMSC: MessageFns<MsgDeployNMSC> = {
  encode(message: MsgDeployNMSC, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.signer !== "") {
      writer.uint32(10).string(message.signer);
    }
    if (message.accountId !== undefined) {
      AccountId.encode(message.accountId, writer.uint32(18).fork()).join();
    }
    if (message.txHash !== "") {
      writer.uint32(26).string(message.txHash);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): MsgDeployNMSC {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgDeployNMSC();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }

          message.signer = reader.string();
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }

          message.accountId = AccountId.decode(reader, reader.uint32());
          continue;
        }
        case 3: {
          if (tag !== 26) {
            break;
          }

          message.txHash = reader.string();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): MsgDeployNMSC {
    return {
      signer: isSet(object.signer) ? globalThis.String(object.signer) : "",
      accountId: isSet(object.accountId) ? AccountId.fromJSON(object.accountId) : undefined,
      txHash: isSet(object.txHash) ? globalThis.String(object.txHash) : "",
    };
  },

  toJSON(message: MsgDeployNMSC): unknown {
    const obj: any = {};
    if (message.signer !== "") {
      obj.signer = message.signer;
    }
    if (message.accountId !== undefined) {
      obj.accountId = AccountId.toJSON(message.accountId);
    }
    if (message.txHash !== "") {
      obj.txHash = message.txHash;
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<MsgDeployNMSC>, I>>(base?: I): MsgDeployNMSC {
    return MsgDeployNMSC.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<MsgDeployNMSC>, I>>(object: I): MsgDeployNMSC {
    const message = createBaseMsgDeployNMSC();
    message.signer = object.signer ?? "";
    message.accountId = (object.accountId !== undefined && object.accountId !== null)
      ? AccountId.fromPartial(object.accountId)
      : undefined;
    message.txHash = object.txHash ?? "";
    return message;
  },
};

function createBaseMsgMintPush(): MsgMintPush {
  return { signer: "", accountId: undefined, txHash: "" };
}

export const MsgMintPush: MessageFns<MsgMintPush> = {
  encode(message: MsgMintPush, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.signer !== "") {
      writer.uint32(10).string(message.signer);
    }
    if (message.accountId !== undefined) {
      AccountId.encode(message.accountId, writer.uint32(18).fork()).join();
    }
    if (message.txHash !== "") {
      writer.uint32(26).string(message.txHash);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): MsgMintPush {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgMintPush();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }

          message.signer = reader.string();
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }

          message.accountId = AccountId.decode(reader, reader.uint32());
          continue;
        }
        case 3: {
          if (tag !== 26) {
            break;
          }

          message.txHash = reader.string();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): MsgMintPush {
    return {
      signer: isSet(object.signer) ? globalThis.String(object.signer) : "",
      accountId: isSet(object.accountId) ? AccountId.fromJSON(object.accountId) : undefined,
      txHash: isSet(object.txHash) ? globalThis.String(object.txHash) : "",
    };
  },

  toJSON(message: MsgMintPush): unknown {
    const obj: any = {};
    if (message.signer !== "") {
      obj.signer = message.signer;
    }
    if (message.accountId !== undefined) {
      obj.accountId = AccountId.toJSON(message.accountId);
    }
    if (message.txHash !== "") {
      obj.txHash = message.txHash;
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<MsgMintPush>, I>>(base?: I): MsgMintPush {
    return MsgMintPush.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<MsgMintPush>, I>>(object: I): MsgMintPush {
    const message = createBaseMsgMintPush();
    message.signer = object.signer ?? "";
    message.accountId = (object.accountId !== undefined && object.accountId !== null)
      ? AccountId.fromPartial(object.accountId)
      : undefined;
    message.txHash = object.txHash ?? "";
    return message;
  },
};

function createBaseCrossChainPayload(): CrossChainPayload {
  return {
    target: "",
    value: "",
    data: "",
    gasLimit: "",
    maxFeePerGas: "",
    maxPriorityFeePerGas: "",
    nonce: "",
    deadline: "",
  };
}

export const CrossChainPayload: MessageFns<CrossChainPayload> = {
  encode(message: CrossChainPayload, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.target !== "") {
      writer.uint32(10).string(message.target);
    }
    if (message.value !== "") {
      writer.uint32(18).string(message.value);
    }
    if (message.data !== "") {
      writer.uint32(26).string(message.data);
    }
    if (message.gasLimit !== "") {
      writer.uint32(34).string(message.gasLimit);
    }
    if (message.maxFeePerGas !== "") {
      writer.uint32(42).string(message.maxFeePerGas);
    }
    if (message.maxPriorityFeePerGas !== "") {
      writer.uint32(50).string(message.maxPriorityFeePerGas);
    }
    if (message.nonce !== "") {
      writer.uint32(58).string(message.nonce);
    }
    if (message.deadline !== "") {
      writer.uint32(66).string(message.deadline);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): CrossChainPayload {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseCrossChainPayload();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }

          message.target = reader.string();
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }

          message.value = reader.string();
          continue;
        }
        case 3: {
          if (tag !== 26) {
            break;
          }

          message.data = reader.string();
          continue;
        }
        case 4: {
          if (tag !== 34) {
            break;
          }

          message.gasLimit = reader.string();
          continue;
        }
        case 5: {
          if (tag !== 42) {
            break;
          }

          message.maxFeePerGas = reader.string();
          continue;
        }
        case 6: {
          if (tag !== 50) {
            break;
          }

          message.maxPriorityFeePerGas = reader.string();
          continue;
        }
        case 7: {
          if (tag !== 58) {
            break;
          }

          message.nonce = reader.string();
          continue;
        }
        case 8: {
          if (tag !== 66) {
            break;
          }

          message.deadline = reader.string();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): CrossChainPayload {
    return {
      target: isSet(object.target) ? globalThis.String(object.target) : "",
      value: isSet(object.value) ? globalThis.String(object.value) : "",
      data: isSet(object.data) ? globalThis.String(object.data) : "",
      gasLimit: isSet(object.gasLimit) ? globalThis.String(object.gasLimit) : "",
      maxFeePerGas: isSet(object.maxFeePerGas) ? globalThis.String(object.maxFeePerGas) : "",
      maxPriorityFeePerGas: isSet(object.maxPriorityFeePerGas) ? globalThis.String(object.maxPriorityFeePerGas) : "",
      nonce: isSet(object.nonce) ? globalThis.String(object.nonce) : "",
      deadline: isSet(object.deadline) ? globalThis.String(object.deadline) : "",
    };
  },

  toJSON(message: CrossChainPayload): unknown {
    const obj: any = {};
    if (message.target !== "") {
      obj.target = message.target;
    }
    if (message.value !== "") {
      obj.value = message.value;
    }
    if (message.data !== "") {
      obj.data = message.data;
    }
    if (message.gasLimit !== "") {
      obj.gasLimit = message.gasLimit;
    }
    if (message.maxFeePerGas !== "") {
      obj.maxFeePerGas = message.maxFeePerGas;
    }
    if (message.maxPriorityFeePerGas !== "") {
      obj.maxPriorityFeePerGas = message.maxPriorityFeePerGas;
    }
    if (message.nonce !== "") {
      obj.nonce = message.nonce;
    }
    if (message.deadline !== "") {
      obj.deadline = message.deadline;
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<CrossChainPayload>, I>>(base?: I): CrossChainPayload {
    return CrossChainPayload.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<CrossChainPayload>, I>>(object: I): CrossChainPayload {
    const message = createBaseCrossChainPayload();
    message.target = object.target ?? "";
    message.value = object.value ?? "";
    message.data = object.data ?? "";
    message.gasLimit = object.gasLimit ?? "";
    message.maxFeePerGas = object.maxFeePerGas ?? "";
    message.maxPriorityFeePerGas = object.maxPriorityFeePerGas ?? "";
    message.nonce = object.nonce ?? "";
    message.deadline = object.deadline ?? "";
    return message;
  },
};

function createBaseMsgExecutePayload(): MsgExecutePayload {
  return { signer: "", accountId: undefined, crosschainPayload: undefined, signature: "" };
}

export const MsgExecutePayload: MessageFns<MsgExecutePayload> = {
  encode(message: MsgExecutePayload, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.signer !== "") {
      writer.uint32(10).string(message.signer);
    }
    if (message.accountId !== undefined) {
      AccountId.encode(message.accountId, writer.uint32(18).fork()).join();
    }
    if (message.crosschainPayload !== undefined) {
      CrossChainPayload.encode(message.crosschainPayload, writer.uint32(26).fork()).join();
    }
    if (message.signature !== "") {
      writer.uint32(34).string(message.signature);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): MsgExecutePayload {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgExecutePayload();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }

          message.signer = reader.string();
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }

          message.accountId = AccountId.decode(reader, reader.uint32());
          continue;
        }
        case 3: {
          if (tag !== 26) {
            break;
          }

          message.crosschainPayload = CrossChainPayload.decode(reader, reader.uint32());
          continue;
        }
        case 4: {
          if (tag !== 34) {
            break;
          }

          message.signature = reader.string();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): MsgExecutePayload {
    return {
      signer: isSet(object.signer) ? globalThis.String(object.signer) : "",
      accountId: isSet(object.accountId) ? AccountId.fromJSON(object.accountId) : undefined,
      crosschainPayload: isSet(object.crosschainPayload)
        ? CrossChainPayload.fromJSON(object.crosschainPayload)
        : undefined,
      signature: isSet(object.signature) ? globalThis.String(object.signature) : "",
    };
  },

  toJSON(message: MsgExecutePayload): unknown {
    const obj: any = {};
    if (message.signer !== "") {
      obj.signer = message.signer;
    }
    if (message.accountId !== undefined) {
      obj.accountId = AccountId.toJSON(message.accountId);
    }
    if (message.crosschainPayload !== undefined) {
      obj.crosschainPayload = CrossChainPayload.toJSON(message.crosschainPayload);
    }
    if (message.signature !== "") {
      obj.signature = message.signature;
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<MsgExecutePayload>, I>>(base?: I): MsgExecutePayload {
    return MsgExecutePayload.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<MsgExecutePayload>, I>>(object: I): MsgExecutePayload {
    const message = createBaseMsgExecutePayload();
    message.signer = object.signer ?? "";
    message.accountId = (object.accountId !== undefined && object.accountId !== null)
      ? AccountId.fromPartial(object.accountId)
      : undefined;
    message.crosschainPayload = (object.crosschainPayload !== undefined && object.crosschainPayload !== null)
      ? CrossChainPayload.fromPartial(object.crosschainPayload)
      : undefined;
    message.signature = object.signature ?? "";
    return message;
  },
};

type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined;

export type DeepPartial<T> = T extends Builtin ? T
  : T extends globalThis.Array<infer U> ? globalThis.Array<DeepPartial<U>>
  : T extends ReadonlyArray<infer U> ? ReadonlyArray<DeepPartial<U>>
  : T extends {} ? { [K in keyof T]?: DeepPartial<T[K]> }
  : Partial<T>;

type KeysOfUnion<T> = T extends T ? keyof T : never;
export type Exact<P, I extends P> = P extends Builtin ? P
  : P & { [K in keyof P]: Exact<P[K], I[K]> } & { [K in Exclude<keyof I, KeysOfUnion<P>>]: never };

function isSet(value: any): boolean {
  return value !== null && value !== undefined;
}

export interface MessageFns<T> {
  encode(message: T, writer?: BinaryWriter): BinaryWriter;
  decode(input: BinaryReader | Uint8Array, length?: number): T;
  fromJSON(object: any): T;
  toJSON(message: T): unknown;
  create<I extends Exact<DeepPartial<T>, I>>(base?: I): T;
  fromPartial<I extends Exact<DeepPartial<T>, I>>(object: I): T;
}
