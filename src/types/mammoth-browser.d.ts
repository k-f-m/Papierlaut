/**
 * Minimal typings for mammoth's prebuilt browser bundle. The package ships
 * types for its Node entry point only, and that entry pulls in `fs`.
 */
declare module 'mammoth/mammoth.browser.js' {
  export interface MammothMessage {
    type: 'warning' | 'error' | 'info' | string;
    message: string;
  }

  export interface MammothResult {
    value: string;
    messages: MammothMessage[];
  }

  export interface MammothOptions {
    styleMap?: string | readonly string[];
    includeDefaultStyleMap?: boolean;
    ignoreEmptyParagraphs?: boolean;
  }

  export interface MammothInput {
    arrayBuffer: ArrayBuffer;
  }

  export interface MammothApi {
    convertToHtml(input: MammothInput, options?: MammothOptions): Promise<MammothResult>;
    extractRawText(input: MammothInput): Promise<MammothResult>;
  }

  const mammoth: MammothApi;
  export default mammoth;
  export const convertToHtml: MammothApi['convertToHtml'];
  export const extractRawText: MammothApi['extractRawText'];
}
