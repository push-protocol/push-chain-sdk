import { Transaction } from "@pushchain/devnet/src/lib/generated/tx";

export const APP_ROUTES = {
  LANDING_PAGE: '/',
  SIMULATE: '/simulate',
};

export const mockTransaction: Transaction = {
  "type": 0,
  "category": "CUSTOM:SAMPLE_TX",
  "sender": "",
  "recipients": [
    "eip155:1:0x35B84d6848D16415177c64D64504663b998A6ab4",
    "eip155:97:0xD8634C39BBFd4033c0d3289C4515275102423681"
  ],
  data: new Uint8Array([1, 2, 3, 4, 5]),
  salt: new Uint8Array([10, 20, 30, 40, 50]),
  apiToken: new Uint8Array([99, 88, 77, 66, 55]),
  signature: new Uint8Array([200, 201, 202, 203, 204]),
  "fee": "0"
}