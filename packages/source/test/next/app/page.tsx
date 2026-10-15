import Counter from './Counter';
import Badge from './Badge';
import Excluded from './Excluded';
import Vendor from 'vendor-ui';
import ClientJsx from './ClientJsx';

export default function Page() {
  return (
    <main data-testid="page">
      <Counter />
      <Badge />
      <Excluded />
      <Vendor />
      <ClientJsx />
    </main>
  );
}
