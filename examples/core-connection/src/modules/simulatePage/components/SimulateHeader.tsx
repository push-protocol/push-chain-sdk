import { Box } from 'shared-components';
import { useGlobalContext } from '../../../context/GlobalContext';
import { TogglePushWalletButton } from '../../../../../../packages/ui-kit';

const SimulateHeader = () => {
  const { account } = useGlobalContext();

  return (
    <Box display="flex" justifyContent="end" width="100%">
      {account && <TogglePushWalletButton account={account} />}
    </Box>
  );
};

export { SimulateHeader };
