import { UniversalSigner, ValidatedUniversalSigner } from './signer.types';

export class Signer {
  static create(universalSigner: UniversalSigner): ValidatedUniversalSigner {
    return universalSigner;
  }
}