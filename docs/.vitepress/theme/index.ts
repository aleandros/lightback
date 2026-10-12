import { h } from 'vue';
import DefaultTheme from 'vitepress/theme';
import hero from '../../assets/hero.png';
import './style.css';

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, {
    'home-hero-image': () => h('img', {
      src: hero,
      class: 'lb-hero-image',
      alt: 'A comment anchored to the selected element in the Lightback playground',
      width: 2560,
      height: 1600,
    }),
  }),
};
