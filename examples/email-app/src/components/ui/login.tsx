import { usePrivy } from '@privy-io/react-auth';
import { useAppContext } from '@/context/app-context';
import { Button } from './button';

const Login = () => {
  const { login } = usePrivy();
  const { pushNetwork, setPushAccount } = useAppContext();
  const pushWalletLoginHandler = async () => {
    try {
      if (pushNetwork) {
        const acc = await pushNetwork.wallet.connect();
        setPushAccount(acc);
      }
    } catch (err) {
      alert(err);
    }
  };

  return (
    <div className="flex flex-row gap-4 items-center justify-center h-full w-full">
      <Button onClick={login} variant={'outline'}>
        Login w/ any wallet
      </Button>
      <Button onClick={pushWalletLoginHandler}>Login w/ Push Wallet</Button>
    </div>
  );
};

export default Login;