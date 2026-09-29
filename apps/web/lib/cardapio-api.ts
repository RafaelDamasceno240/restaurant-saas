import { apiFetch } from './api-client';

export interface Category {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  active: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  tenantId: string;
  categoryId: string;
  categoryName: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  active: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryInput {
  name: string;
  description?: string;
  active?: boolean;
  displayOrder?: number;
}

export interface ProductInput {
  categoryId: string;
  name: string;
  description?: string;
  price: number;
  imageUrl?: string;
  active?: boolean;
  displayOrder?: number;
}

export const categoriesApi = {
  list: (token: string) => apiFetch<Category[]>('/categories', { accessToken: token }),
  create: (token: string, input: CategoryInput) =>
    apiFetch<Category>('/categories', { method: 'POST', body: input, accessToken: token }),
  update: (token: string, id: string, input: Partial<CategoryInput>) =>
    apiFetch<Category>(`/categories/${id}`, { method: 'PATCH', body: input, accessToken: token }),
  remove: (token: string, id: string) =>
    apiFetch<void>(`/categories/${id}`, { method: 'DELETE', accessToken: token }),
};

export const productsApi = {
  list: (token: string) => apiFetch<Product[]>('/products', { accessToken: token }),
  create: (token: string, input: ProductInput) =>
    apiFetch<Product>('/products', { method: 'POST', body: input, accessToken: token }),
  update: (token: string, id: string, input: Partial<ProductInput>) =>
    apiFetch<Product>(`/products/${id}`, { method: 'PATCH', body: input, accessToken: token }),
  remove: (token: string, id: string) =>
    apiFetch<void>(`/products/${id}`, { method: 'DELETE', accessToken: token }),
};
