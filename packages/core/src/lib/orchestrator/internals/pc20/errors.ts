/**
 * Typed PC20 errors.
 *
 * Every error carries a stable `code` discriminator so callers classify by
 * `instanceof` or `err.code` rather than by parsing messages, and structured
 * context fields (supplied chain, supplied address, expected chain, resolved
 * namespace) plus a concise remediation hint.
 *
 * Two rules these must not break:
 *  - Never classify a token by symbol. PC20 identity is address-and-chain only.
 *  - Never embed raw RPC payloads in the message. Context fields are curated.
 */

export type PC20ErrorContext = {
  /** Chain the caller supplied, when relevant. */
  chain?: string;
  /** Address the caller supplied, when relevant. */
  address?: string;
  /** Chain the SDK expected — signer chain, `from.chain`, or the Push chain. */
  expectedChain?: string;
  /** Resolved CAIP-2 namespace used for the registry read. */
  chainNamespace?: string;
  /** Short, actionable remediation. */
  hint?: string;
};

/** Base class for all PC20 failures. `instanceof PC20Error` catches the family. */
export class PC20Error extends Error {
  readonly code: string;
  readonly chain?: string;
  readonly address?: string;
  readonly expectedChain?: string;
  readonly chainNamespace?: string;
  readonly hint?: string;

  constructor(code: string, message: string, ctx: PC20ErrorContext = {}) {
    const parts = [message];
    if (ctx.chain) parts.push(`chain=${ctx.chain}`);
    if (ctx.address) parts.push(`address=${ctx.address}`);
    if (ctx.expectedChain) parts.push(`expectedChain=${ctx.expectedChain}`);
    if (ctx.chainNamespace) parts.push(`namespace=${ctx.chainNamespace}`);
    if (ctx.hint) parts.push(`— ${ctx.hint}`);
    super(parts.join(' '));
    this.name = new.target.name;
    this.code = code;
    this.chain = ctx.chain;
    this.address = ctx.address;
    this.expectedChain = ctx.expectedChain;
    this.chainNamespace = ctx.chainNamespace;
    this.hint = ctx.hint;
  }
}

/** Address is malformed for the supplied chain's VM, or is the zero/default address. */
export class InvalidPC20AddressError extends PC20Error {
  constructor(message: string, ctx: PC20ErrorContext = {}) {
    super('PC20_INVALID_ADDRESS', message, ctx);
  }
}

/**
 * `funds.token.chain` does not match where the funds actually are — the signer's
 * chain for a direct external route, `params.from.chain` for a CEA-origin route,
 * or the Push chain for an export.
 *
 * This is the check that stops a wrapper address copied onto the wrong chain.
 */
export class PC20TokenChainMismatchError extends PC20Error {
  constructor(ctx: PC20ErrorContext = {}) {
    super(
      'PC20_TOKEN_CHAIN_MISMATCH',
      'PC20 token chain does not match the chain the funds are on.',
      {
        hint:
          'funds.token.chain must be where the token lives, not the ' +
          'destination. `to.chain` is the destination.',
        ...ctx,
      }
    );
  }
}

/** UniversalCore has no source mapping for this wrapper on this chain. */
export class PC20WrapperNotRegisteredError extends PC20Error {
  constructor(ctx: PC20ErrorContext = {}) {
    super(
      'PC20_WRAPPER_NOT_REGISTERED',
      'No PC20 wrapper is registered at this address on this chain.',
      {
        hint:
          'Confirm the wrapper has been deployed by an export to this chain, ' +
          'and that the address belongs to this chain.',
        ...ctx,
      }
    );
  }
}

/**
 * Forward and reverse registry lookups disagree: `getPC20Source(wrapper)`
 * resolved a source whose `getPC20Wrapper(source)` is a different address.
 *
 * A stale or partially-written registry entry. Never proceed — the burn would
 * unlock the wrong Push token.
 */
export class PC20RegistryMismatchError extends PC20Error {
  constructor(ctx: PC20ErrorContext & { resolvedWrapper?: string } = {}) {
    super(
      'PC20_REGISTRY_MISMATCH',
      `PC20 registry forward/reverse mismatch${
        ctx.resolvedWrapper ? ` (reverse resolved to ${ctx.resolvedWrapper})` : ''
      }.`,
      { hint: 'This is a registry inconsistency; do not retry blindly.', ...ctx }
    );
  }
}

/**
 * The live external gateway's configured `pc20Factory` differs from the
 * reference factory (the destination Vault's, or UniversalCore's registry if
 * exposed), or the factory does not recognize the wrapper.
 *
 * Proceeding risks the gateway taking the non-PC20 path for this token.
 */
export class PC20FactoryMismatchError extends PC20Error {
  constructor(ctx: PC20ErrorContext & { gatewayFactory?: string; registryFactory?: string } = {}) {
    super(
      'PC20_FACTORY_MISMATCH',
      'PC20 factory identity mismatch between the live gateway and UniversalCore.',
      {
        hint: 'The deployment is misconfigured; report it rather than retrying.',
        ...ctx,
      }
    );
  }
}

/** Token does not expose usable ERC-20 metadata, or the metadata fails validation. */
export class InvalidPC20MetadataError extends PC20Error {
  constructor(message: string, ctx: PC20ErrorContext = {}) {
    super('PC20_INVALID_METADATA', message, ctx);
  }
}

/**
 * A synthetic PRC20 address was supplied where a Push-native PC20 was expected.
 *
 * Distinct from {@link InvalidPC20MetadataError}: a PRC20 is a legitimate token
 * on the wrong API, not a broken one. Kept separate so the message can point at
 * the right call instead of reading as "your token is invalid".
 */
export class PC20ExpectedButPRC20Error extends PC20Error {
  constructor(ctx: PC20ErrorContext = {}) {
    super(
      'PC20_EXPECTED_BUT_PRC20',
      'This address is a synthetic PRC20, not a Push-native PC20.',
      {
        hint:
          'Move PRC20 tokens with the MoveableToken API ' +
          '(pushChainClient.moveable.token.*), not a { chain, address } PC20 reference.',
        ...ctx,
      }
    );
  }
}

/** Destination chain has no configured PC20 factory, or is not supported for PC20. */
export class UnsupportedPC20DestinationError extends PC20Error {
  constructor(ctx: PC20ErrorContext = {}) {
    super(
      'PC20_UNSUPPORTED_DESTINATION',
      'PC20 export is not configured for this destination chain.',
      { hint: 'No PC20 factory is registered for this chain namespace.', ...ctx }
    );
  }
}

/** Caller's balance of the wrapper (inbound) or Push source (export) is short. */
export class InsufficientPC20BalanceError extends PC20Error {
  constructor(ctx: PC20ErrorContext & { required?: bigint; available?: bigint } = {}) {
    super(
      'PC20_INSUFFICIENT_BALANCE',
      `Insufficient PC20 balance${
        ctx.required !== undefined && ctx.available !== undefined
          ? ` (required ${ctx.required}, available ${ctx.available})`
          : ''
      }.`,
      ctx
    );
  }
}

/**
 * The same address is registered on more than one chain, resolving to
 * different Push sources, and no `chain` was supplied to disambiguate.
 *
 * Only reachable from the lookup utility's optional-chain path. Picking the
 * first match would be the one way that convenience could actively mislead —
 * the caller would get a confident answer about the wrong token.
 */
export class PC20AmbiguousAddressError extends PC20Error {
  readonly candidates: Array<{ chain: string; pushAddress: string }>;

  constructor(
    address: string,
    candidates: Array<{ chain: string; pushAddress: string }>
  ) {
    super(
      'PC20_AMBIGUOUS_ADDRESS',
      `Address is registered on ${candidates.length} chains with different Push sources ` +
        `(${candidates.map((c) => `${c.chain}→${c.pushAddress}`).join(', ')}).`,
      {
        address,
        hint: 'Pass `chain` in the options to disambiguate.',
      }
    );
    this.candidates = candidates;
  }
}

/**
 * A chain namespace could not be mapped in either direction.
 *
 * Thrown rather than returning a negative result: an unmapped namespace reads
 * from the registry as "not deployed", hiding the actual bug.
 */
export class PC20UnknownChainNamespaceError extends PC20Error {
  constructor(namespace: string, ctx: PC20ErrorContext = {}) {
    super('PC20_UNKNOWN_CHAIN_NAMESPACE', 'Unknown PC20 chain namespace.', {
      chainNamespace: namespace,
      ...ctx,
    });
  }
}

/**
 * The destination wrapper address for a first export could not be predicted.
 *
 * Thrown strictly BEFORE approval. A first export commits the source token into
 * VaultPC20 before the destination transfer is built, so an unverifiable
 * prediction must abort rather than fall back to a guess.
 */
export class PC20WrapperPredictionUnavailableError extends PC20Error {
  constructor(ctx: PC20ErrorContext = {}) {
    super(
      'PC20_WRAPPER_PREDICTION_UNAVAILABLE',
      'Could not determine the destination PC20 wrapper address for a first export.',
      {
        hint:
          'Aborted before approval so no funds are locked. Retry once the ' +
          'destination factory is reachable.',
        ...ctx,
      }
    );
  }
}

/** A PC20 export reverted after the source token was locked. Carries recovery context. */
export class PC20ExportRevertedError extends PC20Error {
  readonly outboundTxId?: string;
  readonly lockedAmount?: bigint;
  readonly revertRecipient?: string;

  constructor(
    ctx: PC20ErrorContext & {
      outboundTxId?: string;
      lockedAmount?: bigint;
      revertRecipient?: string;
    } = {}
  ) {
    super('PC20_EXPORT_REVERTED', 'PC20 export reverted after the source token was locked.', {
      hint: 'Funds return to the revert recipient on Push Chain.',
      ...ctx,
    });
    this.outboundTxId = ctx.outboundTxId;
    this.lockedAmount = ctx.lockedAmount;
    this.revertRecipient = ctx.revertRecipient;
  }
}

/**
 * A wrapper burn was about to be submitted without any Push-side payload.
 *
 * Until every supported Push Chain version treats selector-only PC20 payloads
 * as an empty payload, broadcasting this shape can burn the wrapper and leave
 * the canonical token permanently locked. The SDK therefore fails closed.
 */
export class PC20UnsafeEmptyPayloadError extends PC20Error {
  constructor(ctx: PC20ErrorContext = {}) {
    super(
      'PC20_UNSAFE_EMPTY_PAYLOAD',
      'Refusing to submit a PC20 burn without a Push-side forwarding payload.',
      {
        hint:
          'Prepare the transaction again with an SDK version that always ' +
          'attaches the PC20 transfer payload.',
        ...ctx,
      }
    );
  }
}
