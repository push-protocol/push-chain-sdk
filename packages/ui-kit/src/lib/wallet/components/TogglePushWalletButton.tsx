import React from 'react';
import { centerMaskString } from '../wallet.utils';
import { CHAIN_LOGO } from '../../constants';
import { usePushWalletContext } from './PushWalletProvider';
import { PushLogo, PushMonotone } from '../../common';
import styled from 'styled-components';
import { UniversalAddress } from '../wallet.types';

type TogglePushWalletButtonProps = {
  universalAddress: UniversalAddress;
};
const TogglePushWalletButton: React.FC<TogglePushWalletButtonProps> = ({
  universalAddress,
}) => {
  const { setMinimiseWallet } = usePushWalletContext();

  const { chainId, address } = universalAddress;

  function getChainIcon(chainId: string | null) {
    if (!chainId) {
      return <PushMonotone />;
    }
    const IconComponent = CHAIN_LOGO[chainId];
    if (IconComponent) {
      return <IconComponent />;
    } else {
      return <PushMonotone />;
    }
  }

  const maskedAddress = centerMaskString(address);

  return (
    <>
      <ButtonComponent onClick={() => setMinimiseWallet(false)}>
        {getChainIcon(chainId)}
        {maskedAddress}
        <PushLogo />
      </ButtonComponent>
    </>
  );
};

export { TogglePushWalletButton };

const ButtonComponent = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-family: FK Grotesk Neu;
  white-space: nowrap;
  flex-shrink: 0;
  border: none;
  background-color: #17181b;
  color: rgba(255, 255, 255, 1);
  border-radius: 12px;
  gap: 4px;
  height: 48px;
  padding: 16px 24px;
  min-width: 100px;
  leading-trim: both;
  text-edge: cap;
  font-size: 16px;
  font-style: normal;
  font-weight: 500;
  line-height: 16px;
`;
