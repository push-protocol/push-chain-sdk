import React from 'react';
import { useDarkMode } from '../common/hooks';
import { MdOutlineLightMode } from "react-icons/md";
import { MdOutlineDarkMode } from "react-icons/md";
import { Box } from 'shared-components';
import { PushUniversalWallet, usePushWalletContext } from '../../../../../packages/ui-kit';

const Navbar = () => {
    const { isDarkMode, enable, disable } = useDarkMode();

    const { universalAddress } = usePushWalletContext();

    return (
        <Box
            display='flex'
            justifyContent='end'
            gap='spacing-md'
        >
            {universalAddress && <PushUniversalWallet />}

            {!isDarkMode ? (
                <Box
                    border='border-sm solid stroke-tertiary'
                    padding='spacing-xxs'
                    borderRadius='radius-sm'
                    onClick={enable}>
                    <MdOutlineDarkMode size={28} />
                </Box>
            ) : (
                <Box
                    border='border-sm solid stroke-tertiary'
                    padding='spacing-xxs'
                    borderRadius='radius-sm'
                    onClick={disable}>
                    <MdOutlineLightMode color='white' size={28} />
                </Box>
            )}
        </Box>
    );
};

export default Navbar;