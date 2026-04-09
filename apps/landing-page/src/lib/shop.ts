import type { ShopContent } from './types';

import bathouseTote1 from '../assets/images/merch/bathhouse-tote/DSCF4134.webp';
import bathouseTote2 from '../assets/images/merch/bathhouse-tote/DSCF4135.webp';
import dualityShirt1 from '../assets/images/merch/duality-shirt/DSCF4130.webp';
import dualityShirt4 from '../assets/images/merch/duality-shirt/DSCF4126.webp';
import ogSticker from '../assets/images/merch/pyre-og-sticker/DSCF4141.webp';
import ogSticker2 from '../assets/images/merch/pyre-og-sticker/DSCF4143.webp';

const shop: ShopContent = {
  title: 'Shop',
  subtitle: 'Take the Pyre experience home with you.',
  emptyMessage: 'New products dropping soon — check back.',
  products: [
    {
      id: 'bathhouse-tote',
      momenceId: 439299,
      name: 'The Bathhouse Tote',
      // description:
      //   'A double-sided tote big enough to carry everything you need for the Pyre experience — towels, water bottle, sandals, and a clean change of clothes.',
      price: 25,
      category: 'Accessories',
      images: [
        { src: bathouseTote2, alt: 'The Bathhouse Tote by Pyre — reverse side' },
        { src: bathouseTote1, alt: 'The Bathhouse Tote by Pyre' },
      ],
      purchaseUrl: 'https://momence.com/g/439299',
    },
    {
      id: 'duality-shirt',
      momenceId: 439332,
      name: 'Pyre Duality Shirt',
      // description:
      //   'An extremely comfortable tee that showcases the human connection of sauna bathing.',
      price: 30,
      category: 'Apparel',
      images: [
        { src: dualityShirt4, alt: 'Pyre Duality Shirt — back' },
        { src: dualityShirt1, alt: 'Pyre Duality Shirt — worn' },
        // { src: dualityShirt2, alt: 'Pyre Duality Shirt — front' },
        // { src: dualityShirt3, alt: 'Pyre Duality Shirt — detail' },
      ],
      purchaseUrl: 'https://momence.com/g/439332',
    },
    {
      id: 'og-sticker',
      momenceId: 439371,
      name: 'Pyre OG Sticker',
      // description:
      //   'A limited edition sticker featuring the Pyre logo.',
      price: 3,
      category: 'Accessories',
      images: [
        { src: ogSticker2, alt: 'Pyre OG Sticker' },
        { src: ogSticker, alt: 'Pyre OG Sticker' },
      ],
      purchaseUrl: 'https://momence.com/g/439371',
    },
  ],
};

export default shop;
