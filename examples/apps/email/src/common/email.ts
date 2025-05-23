import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";

export const protobufPackage = "email";

export enum BodyFormat {
  PLAIN_TEXT = 0,
  HTML = 1,
  MARKDOWN = 2,
  UNRECOGNIZED = -1,
}

export function bodyFormatFromJSON(object: any): BodyFormat {
  switch (object) {
    case 0:
    case "PLAIN_TEXT":
      return BodyFormat.PLAIN_TEXT;
    case 1:
    case "HTML":
      return BodyFormat.HTML;
    case 2:
    case "MARKDOWN":
      return BodyFormat.MARKDOWN;
    case -1:
    case "UNRECOGNIZED":
    default:
      return BodyFormat.UNRECOGNIZED;
  }
}

export function bodyFormatToJSON(object: BodyFormat): string {
  switch (object) {
    case BodyFormat.PLAIN_TEXT:
      return "PLAIN_TEXT";
    case BodyFormat.HTML:
      return "HTML";
    case BodyFormat.MARKDOWN:
      return "MARKDOWN";
    case BodyFormat.UNRECOGNIZED:
    default:
      return "UNRECOGNIZED";
  }
}

export interface Attachment {
  filename: string;
  type: string;
  /** base64 encoded */
  content: string;
}

export interface EmailHeader {
  key: string;
  value: string;
}

export interface EmailBody {
  content: string;
  /** Indicates whether it's plain text or HTML */
  format: BodyFormat;
}

export interface Email {
  subject: string;
  /** Includes both the content and format */
  body:
    | EmailBody
    | undefined;
  /** List of attachments */
  attachments: Attachment[];
  /** Optional/custom headers like priority */
  headers: EmailHeader[];
}

function createBaseAttachment(): Attachment {
  return { filename: "", type: "", content: "" };
}

export const Attachment = {
  encode(message: Attachment, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.filename !== "") {
      writer.uint32(10).string(message.filename);
    }
    if (message.type !== "") {
      writer.uint32(18).string(message.type);
    }
    if (message.content !== "") {
      writer.uint32(26).string(message.content);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): Attachment {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseAttachment();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.filename = reader.string();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.type = reader.string();
          continue;
        case 3:
          if (tag !== 26) {
            break;
          }

          message.content = reader.string();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): Attachment {
    return {
      filename: isSet(object.filename) ? globalThis.String(object.filename) : "",
      type: isSet(object.type) ? globalThis.String(object.type) : "",
      content: isSet(object.content) ? globalThis.String(object.content) : "",
    };
  },

  toJSON(message: Attachment): unknown {
    const obj: any = {};
    if (message.filename !== "") {
      obj.filename = message.filename;
    }
    if (message.type !== "") {
      obj.type = message.type;
    }
    if (message.content !== "") {
      obj.content = message.content;
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<Attachment>, I>>(base?: I): Attachment {
    return Attachment.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<Attachment>, I>>(object: I): Attachment {
    const message = createBaseAttachment();
    message.filename = object.filename ?? "";
    message.type = object.type ?? "";
    message.content = object.content ?? "";
    return message;
  },
};

function createBaseEmailHeader(): EmailHeader {
  return { key: "", value: "" };
}

export const EmailHeader = {
  encode(message: EmailHeader, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.key !== "") {
      writer.uint32(10).string(message.key);
    }
    if (message.value !== "") {
      writer.uint32(18).string(message.value);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): EmailHeader {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseEmailHeader();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.key = reader.string();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.value = reader.string();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): EmailHeader {
    return {
      key: isSet(object.key) ? globalThis.String(object.key) : "",
      value: isSet(object.value) ? globalThis.String(object.value) : "",
    };
  },

  toJSON(message: EmailHeader): unknown {
    const obj: any = {};
    if (message.key !== "") {
      obj.key = message.key;
    }
    if (message.value !== "") {
      obj.value = message.value;
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<EmailHeader>, I>>(base?: I): EmailHeader {
    return EmailHeader.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<EmailHeader>, I>>(object: I): EmailHeader {
    const message = createBaseEmailHeader();
    message.key = object.key ?? "";
    message.value = object.value ?? "";
    return message;
  },
};

function createBaseEmailBody(): EmailBody {
  return { content: "", format: 0 };
}

export const EmailBody = {
  encode(message: EmailBody, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.content !== "") {
      writer.uint32(10).string(message.content);
    }
    if (message.format !== 0) {
      writer.uint32(16).int32(message.format);
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): EmailBody {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseEmailBody();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.content = reader.string();
          continue;
        case 2:
          if (tag !== 16) {
            break;
          }

          message.format = reader.int32() as any;
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): EmailBody {
    return {
      content: isSet(object.content) ? globalThis.String(object.content) : "",
      format: isSet(object.format) ? bodyFormatFromJSON(object.format) : 0,
    };
  },

  toJSON(message: EmailBody): unknown {
    const obj: any = {};
    if (message.content !== "") {
      obj.content = message.content;
    }
    if (message.format !== 0) {
      obj.format = bodyFormatToJSON(message.format);
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<EmailBody>, I>>(base?: I): EmailBody {
    return EmailBody.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<EmailBody>, I>>(object: I): EmailBody {
    const message = createBaseEmailBody();
    message.content = object.content ?? "";
    message.format = object.format ?? 0;
    return message;
  },
};

function createBaseEmail(): Email {
  return { subject: "", body: undefined, attachments: [], headers: [] };
}

export const Email = {
  encode(message: Email, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.subject !== "") {
      writer.uint32(10).string(message.subject);
    }
    if (message.body !== undefined) {
      EmailBody.encode(message.body, writer.uint32(18).fork()).join();
    }
    for (const v of message.attachments) {
      Attachment.encode(v!, writer.uint32(26).fork()).join();
    }
    for (const v of message.headers) {
      EmailHeader.encode(v!, writer.uint32(34).fork()).join();
    }
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): Email {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseEmail();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break;
          }

          message.subject = reader.string();
          continue;
        case 2:
          if (tag !== 18) {
            break;
          }

          message.body = EmailBody.decode(reader, reader.uint32());
          continue;
        case 3:
          if (tag !== 26) {
            break;
          }

          message.attachments.push(Attachment.decode(reader, reader.uint32()));
          continue;
        case 4:
          if (tag !== 34) {
            break;
          }

          message.headers.push(EmailHeader.decode(reader, reader.uint32()));
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): Email {
    return {
      subject: isSet(object.subject) ? globalThis.String(object.subject) : "",
      body: isSet(object.body) ? EmailBody.fromJSON(object.body) : undefined,
      attachments: globalThis.Array.isArray(object?.attachments)
        ? object.attachments.map((e: any) => Attachment.fromJSON(e))
        : [],
      headers: globalThis.Array.isArray(object?.headers) ? object.headers.map((e: any) => EmailHeader.fromJSON(e)) : [],
    };
  },

  toJSON(message: Email): unknown {
    const obj: any = {};
    if (message.subject !== "") {
      obj.subject = message.subject;
    }
    if (message.body !== undefined) {
      obj.body = EmailBody.toJSON(message.body);
    }
    if (message.attachments?.length) {
      obj.attachments = message.attachments.map((e) => Attachment.toJSON(e));
    }
    if (message.headers?.length) {
      obj.headers = message.headers.map((e) => EmailHeader.toJSON(e));
    }
    return obj;
  },

  create<I extends Exact<DeepPartial<Email>, I>>(base?: I): Email {
    return Email.fromPartial(base ?? ({} as any));
  },
  fromPartial<I extends Exact<DeepPartial<Email>, I>>(object: I): Email {
    const message = createBaseEmail();
    message.subject = object.subject ?? "";
    message.body = (object.body !== undefined && object.body !== null) ? EmailBody.fromPartial(object.body) : undefined;
    message.attachments = object.attachments?.map((e) => Attachment.fromPartial(e)) || [];
    message.headers = object.headers?.map((e) => EmailHeader.fromPartial(e)) || [];
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
