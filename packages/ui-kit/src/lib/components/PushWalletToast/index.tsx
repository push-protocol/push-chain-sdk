import React, { FC, useState, useRef, useEffect } from 'react';
import { PROGRESS_HOOK, ProgressEvent } from '@pushchain/core/src/lib/progress-hook/progress-hook.types';
import styled, { css } from 'styled-components';
import { CrossIcon, Spinner, TickIcon, WarningIcon } from '../../components/common';
import CaretDown from '../common/icons/CaretDown';
import CaretUp from '../common/icons/CaretUp';
import ArrowUpRight from '../common/icons/ArrowUpRight';
import { getUniversalTxId } from './trackTransaction';

const TOAST_POSITION = {
    TOP_LEFT: 'top-left',
    TOP_MIDDLE: 'top-middle',
    TOP_RIGHT: 'top-right',
    BOTTOM_LEFT: 'bottom-left',
    BOTTOM_MIDDLE: 'bottom-middle',
    BOTTOM_RIGHT: 'bottom-right',
} as const;

type ToastPosition = typeof TOAST_POSITION[keyof typeof TOAST_POSITION];

type PushWalletToastProps = {
    progress: ProgressEvent | null;
    setProgress: React.Dispatch<React.SetStateAction<ProgressEvent | null>>;
    initialChain?: string;
    className?: string;
    toastPosition?: ToastPosition;
    hidden?: boolean;
};

const TRANSACTION_START_IDS: ReadonlyArray<string> = [
    PROGRESS_HOOK.SEND_TX_001,
    PROGRESS_HOOK.SEND_TX_101,
    PROGRESS_HOOK.SEND_TX_201,
    PROGRESS_HOOK.SEND_TX_301,
];

const SUCCESS_TERMINAL_IDS: ReadonlyArray<string> = [
    PROGRESS_HOOK.SEND_TX_199_01,
    PROGRESS_HOOK.SEND_TX_299_01,
    PROGRESS_HOOK.SEND_TX_399_01,
    PROGRESS_HOOK.SEND_TX_999_01,
    PROGRESS_HOOK.UEA_MIG_9901,
];

const FAILURE_TERMINAL_IDS: ReadonlyArray<string> = [
    PROGRESS_HOOK.SEND_TX_199_02,
    PROGRESS_HOOK.SEND_TX_299_02,
    PROGRESS_HOOK.SEND_TX_299_03,
    PROGRESS_HOOK.SEND_TX_399_02,
    PROGRESS_HOOK.SEND_TX_399_03,
    PROGRESS_HOOK.SEND_TX_999_02,
    PROGRESS_HOOK.SEND_TX_999_03,
];

const PushWalletToast: FC<PushWalletToastProps> = ({
    progress,
    setProgress,
    initialChain,
    className = 'PUAToast',
    toastPosition = 'bottom-right',
    hidden = false,
}) => {

    if (hidden) return null;

    const [isOpen, setIsOpen] = useState(false);
    const [isOverflowing, setIsOverflowing] = useState(false);

    const textRef = useRef<HTMLSpanElement | null>(null);
    const trackedTxRef = useRef<string | null>(null);
    const previousProgressIdRef = useRef<string | null>(null);

    const handleViewOnScan = (txnHash: string) => {
        if (txnHash) {
            window.open(`https://donut.push.network/tx/${txnHash}`, '_blank');
        }
    };

    const handleViewLifecycle = (universalTxId: string) => {
        window.open(
            `https://donut.push.network/track?utx=${universalTxId}`,
            '_blank',
            'noopener,noreferrer'
        );
    };

    useEffect(() => {
        setIsOpen(false);
    }, [progress?.id]);

    useEffect(() => {
        if (textRef.current) {
            const el = textRef.current;
            const overflow = el.scrollWidth > el.clientWidth;
            setIsOverflowing(overflow);
        } else {
            setIsOverflowing(false);
        }
    }, [progress?.message]);

    if (!progress) return null;

    const progressMessage = progress.message ?? '';
    const isInsufficientFundsError = progressMessage.includes('insufficient funds for gas');
    const isSuccess = SUCCESS_TERMINAL_IDS.includes(progress.id);
    const isFailure = FAILURE_TERMINAL_IDS.includes(progress.id) || progress.level === 'ERROR';
    const txHash = (progress.response as { txHash?: string } | null)?.txHash;
    const isNewTransaction = TRANSACTION_START_IDS.includes(progress.id)
        && previousProgressIdRef.current !== progress.id;
    if (isNewTransaction) trackedTxRef.current = null;
    previousProgressIdRef.current = progress.id;
    trackedTxRef.current ??= getUniversalTxId(progress, initialChain);
    const trackedTx = trackedTxRef.current;

    return (
        <ToastContainer className={className} $position={toastPosition}>
            <IconContainer>
                {isSuccess ? (
                    <TickIcon />
                ) : isFailure ? (
                    <WarningIcon />
                ) : (
                    <Spinner color="var(--pw-int-brand-primary-color)" />
                )}
            </IconContainer>

            <ContentContainer>
                <TitleText>{progress.title}</TitleText>

                {isSuccess && txHash && (
                    <LinkText onClick={() => handleViewOnScan(txHash)}>
                        View in Explorer
                    </LinkText>
                )}

                {!isSuccess && !isFailure && trackedTx && (
                    <LinkText onClick={() => handleViewLifecycle(trackedTx)}>
                        Track Live Progress
                        <ArrowUpRight height="14px" width="14px" color="#0056D0" />
                    </LinkText>
                )}

                {isFailure && progressMessage && (
                    <DescriptionContainer>
                        <DescriptionText ref={textRef} $expanded={isOpen}>
                            {isInsufficientFundsError && 'Insufficient funds for gas: \n'}
                            {progressMessage}
                        </DescriptionText>

                        {isOverflowing && (
                            isOpen ? (
                                <ExpandButton onClick={() => setIsOpen(false)}>
                                    View Less
                                    <CaretUp height="18px" width="18px" color="#6B7280" />
                                </ExpandButton>
                            ) : (
                                <ExpandButton onClick={() => setIsOpen(true)}>
                                    View More
                                    <CaretDown height="18px" width="18px" color="#6B7280" />
                                </ExpandButton>
                            )
                        )}
                    </DescriptionContainer>
                )}

                {isFailure && trackedTx && (
                    <LinkText onClick={() => handleViewLifecycle(trackedTx)}>
                        View Tx Lifecycle
                        <ArrowUpRight height="14px" width="14px" color="#0056D0" />
                    </LinkText>
                )}
            </ContentContainer>

            <CloseContainer
                onClick={() => {
                    setProgress(null);
                    setIsOpen(false);
                }}
            >
                <CrossIcon height="18px" width="18px" color="#000000" />
            </CloseContainer>
        </ToastContainer>
    );
};

export { PushWalletToast, TOAST_POSITION };
export { getUniversalTxId } from './trackTransaction';
export type { ToastPosition };

const getToastPositionStyles = (position: ToastPosition) => {
    switch (position) {
        case 'top-left':
            return css`
                top: 40px;
                left: 30px;
            `;

        case 'top-middle':
            return css`
                top: 40px;
                left: 50%;
                transform: translateX(-50%);
            `;

        case 'top-right':
            return css`
                top: 40px;
                right: 30px;
            `;

        case 'bottom-left':
            return css`
                bottom: 40px;
                left: 30px;
            `;

        case 'bottom-middle':
            return css`
                bottom: 40px;
                left: 50%;
                transform: translateX(-50%);
            `;

        case 'bottom-right':
        default:
            return css`
                bottom: 40px;
                right: 30px;
            `;
    }
};

const ToastContainer = styled.div<{ $position: ToastPosition }>`
    position: fixed;
    ${({ $position }) => getToastPositionStyles($position)}

    display: flex;
    flex-direction: row;
    gap: 8px;
    align-items: flex-start;
    border: 1px solid #EAEBF2;
    padding: 16px;
    border-radius: 16px;
    background-color: #fff;
    z-index: 999999990;
    width: 320px;
    max-width: calc(100vw - 32px);
`;

const ContentContainer = styled.div`
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 80%;
    gap: 2px;
`;

const TitleText = styled.h4`
    font-size: 14px;
    font-weight: 500;
    line-height: 21px;
    margin: 0;
    font-family: var(--pw-int-font-family);
    color: #17181B;
`;

const DescriptionContainer = styled.div`
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
`;

const DescriptionText = styled.span<{ $expanded?: boolean }>`
    font-size: 14px;
    font-weight: 400;
    line-height: 18px;
    margin: 0;
    font-family: var(--pw-int-font-family);
    color: #313338;
    width: 100%;
    text-align: left;
    text-overflow: ellipsis;
    overflow: hidden;
    overflow-wrap: anywhere;
    white-space: ${({ $expanded }) => ($expanded ? 'pre-wrap' : 'nowrap')};
`;

const ExpandButton = styled.div`
    display: flex;
    align-items: center;
    font-family: var(--pw-int-font-family);
    font-size: 12px;
    color: #6B7280;
    cursor: pointer;

    &:hover {
        color: #4B5563;
    }
`;

const LinkText = styled.span`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 14px;
    font-weight: 400;
    line-height: 18px;
    cursor: pointer;
    color: #0056D0;
    font-family: var(--pw-int-font-family);
`;

const IconContainer = styled.div`
    height: 21px;
    width: 18px;
    display: flex;
    align-items: center;
`;

const CloseContainer = styled.div`
    display: flex;
    margin-left: auto;
    align-items: center;
    cursor: pointer;
    height: 21px;
`;
