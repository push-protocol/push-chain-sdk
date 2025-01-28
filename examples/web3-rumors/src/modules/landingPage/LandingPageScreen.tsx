import { Box } from 'shared-components';
import { LandingPageLeftComponent } from './components/LandingPageLeftComponent';
import { LandingPageBanner } from './components/LandingPageBanner';

const LandingPageScreen = () => {
  return (
    <Box
      display="flex"
      flexDirection="row"
      justifyContent={{ initial: 'space-between', tb: 'center' }}
      width="100%"
      alignItems="center"
      margin="spacing-xl spacing-none"
    >
      <LandingPageLeftComponent />
      <Box display={{ initial: 'block', tb: 'none' }}>
        <LandingPageBanner height="702px" />
      </Box>
    </Box>
  );
};

export { LandingPageScreen };
