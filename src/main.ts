import './styles.css';
import { mountApp } from './app';

const app = document.querySelector<HTMLElement>('#app');

if (app === null) {
  throw new Error('SNAKISH application shell was not found.');
}

mountApp(app);
