import './styles.css';
import { mountApp } from './app';

const app = document.querySelector<HTMLElement>('#app');

if (app === null) {
  throw new Error('SNAKISH application shell was not found.');
}

const unmountApp = mountApp(app);

if (import.meta.hot !== undefined) {
  import.meta.hot.dispose(unmountApp);
}
