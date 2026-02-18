import socialImage from '../assets/images/cyano_sweat_logo.jpg';

export const SOCIAL_IMAGE = socialImage;
export const SOCIAL_IMAGE_ALT = 'Pyre Sauna + Cold Plunge';
export const SOCIAL_IMAGE_WIDTH = 1920;
export const SOCIAL_IMAGE_HEIGHT = 1293;

// Organization / site-level SEO constants
export const SITE_NAME = 'Pyre Sauna + Cold Plunge';
export const SITE_LOCALE = 'en_US';
export const TWITTER_HANDLE = '@pyre_sauna';

// Organization structured data (reused across JSON-LD schemas)
export const ORGANIZATION = {
	'@type': 'Organization' as const,
	name: 'Pyre Sauna + Cold Plunge',
	url: 'https://pyresauna.com',
	email: 'hi@pyresauna.com',
	sameAs: ['https://instagram.com/pyre_sauna'],
};
