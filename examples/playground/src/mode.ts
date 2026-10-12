export const isDemo = import.meta.env.MODE === 'demo';
export const apiUrl = (path: string) => `${isDemo ? import.meta.env.BASE_URL : '/'}api/${path}`;
