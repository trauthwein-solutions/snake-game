import './styles.css';

const app = document.querySelector<HTMLElement>('#app');

if (app === null) {
  throw new Error('SNAKISH application shell was not found.');
}

app.dataset.ready = 'true';
