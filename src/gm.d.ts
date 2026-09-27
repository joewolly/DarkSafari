// Subset of the Userscripts (quoid/userscripts) GM API that DarkSafari uses.
// https://github.com/quoid/userscripts#api

interface GMXHRResponse {
  status: number;
  statusText: string;
  response: unknown;
  responseText?: string;
  responseURL?: string;
}

interface GMXHRDetails {
  url: string;
  method?: string;
  responseType?: XMLHttpRequestResponseType;
  timeout?: number;
}

declare const GM: {
  getValue<T>(key: string, defaultValue?: T): Promise<T>;
  setValue(key: string, value: unknown): Promise<void>;
  xmlHttpRequest(details: GMXHRDetails): Promise<GMXHRResponse>;
};
