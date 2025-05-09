import { CONSTANTS } from "../constants";

export type LoginMethodConfig = {
    email?: boolean;
    google?: boolean;
    wallet?: {
        enabled?: boolean;
        chains?: (typeof CONSTANTS.CHAIN)[keyof typeof CONSTANTS.CHAIN][];
    };
    appPreview?: boolean;
}

export type PushWalletProviderConfig = {
    uid?: string;
    env: typeof CONSTANTS.ENV[keyof typeof CONSTANTS.ENV];
    rpcURLs?: string[];
    login?: LoginMethodConfig
}

export type AppMetadata = {
    name: string;
    logoUrl?: string;
    description?: string;
}

export type ButtonDefaultsProps = {
    /** “Connect” button text when disconnected */
    connectButtonText?: string;
    /** “Connect” button bg color */
    connectButtonBgColor?: string;
    /** “Connect” button text color */
    connectButtonTextColor?: string;
    /** inline style overrides for the “Connect” button */
    connectButtonStyle?: React.CSSProperties;
    /** custom node to show while connecting */
    loadingComponent?: React.ReactNode;
    /** connected‐state button bg color */
    connectedButtonBgColor?: string;
    /** connected‐state button text color */
    connectedButtonTextColor?: string;
    /** hide the bell icon in connected state */
    hidePushLogo?: boolean;
    /** inline style overrides for the connected‐state button */
    connectedButtonStyle?: React.CSSProperties;
    /** when connected, how the account menu appears */
    accountMenuVariant?: 'full' | 'hover';
}

export type ModalDefaultsProps = {
    /** 
    * “split” shows the preview pane side-by-side with the iframe  
    * “simple” shows only the iframe (no preview) 
    */
    loginLayout?: typeof CONSTANTS.LOGIN.SPLIT | typeof CONSTANTS.LOGIN.SIMPLE;
    /** if true (and `app` is provided), show the preview pane in the wrapper */
    showModalAppPreview?: boolean;
    /** CSS background-image for wrapper or preview pane */
    bgImage?: string;
    /** CSS background-color for wrapper or preview pane */
    bgColor?: string;
    /** CSS text-color for wrapper or preview pane */
    textColor?: string;
}


export type PushWalletProviderProps = {
    children: React.ReactNode;
    config: PushWalletProviderConfig,
    app?: AppMetadata,
    themeMode?: typeof CONSTANTS.THEME.LIGHT | typeof CONSTANTS.THEME.DARK,
    themeOverrides?: Record<string, string>;
    buttonDefaults?: ButtonDefaultsProps,
    modalDefaults?: ModalDefaultsProps
}