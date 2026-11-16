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
  // Promotion: the full price shown struck through ("de R$ 35 por R$ 32"); null = none.
  compareAtPrice: number | null;
  // The pasted link, as saved.
  imageUrl: string | null;
  // What the menu shows: the uploaded/imported photo, else the pasted link.
  photoUrl: string | null;
  hasUploadedPhoto: boolean;
  active: boolean;
  soldOut: boolean;
  featured: boolean;
  displayOrder: number;
  // Add-on groups of the product, in the order the customer sees them.
  optionGroupIds: string[];
  // Created by the menu importer.
  imported: boolean;
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
  description?: string | null;
  price: number;
  compareAtPrice?: number | null;
  imageUrl?: string | null;
  active?: boolean;
  soldOut?: boolean;
  featured?: boolean;
  displayOrder?: number;
}

export interface OptionItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  maxQuantity: number;
  active: boolean;
  soldOut: boolean;
  displayOrder: number;
  imported: boolean;
}

export interface OptionGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  active: boolean;
  imported: boolean;
  productIds: string[];
  // Problems the owner should see (e.g. a required group with nothing to choose).
  warnings: string[];
  options: OptionItem[];
  createdAt: string;
  updatedAt: string;
}

export interface OptionGroupInput {
  name: string;
  minSelect: number;
  maxSelect: number;
  active?: boolean;
}

export interface OptionItemInput {
  name: string;
  description?: string | null;
  price: number;
  maxQuantity?: number;
  active?: boolean;
  soldOut?: boolean;
}

function imageForm(file: Blob): FormData {
  const form = new FormData();
  form.append('file', file);
  return form;
}

export const categoriesApi = {
  list: (token: string) => apiFetch<Category[]>('/categories', { accessToken: token }),
  create: (token: string, input: CategoryInput) =>
    apiFetch<Category>('/categories', { method: 'POST', body: input, accessToken: token }),
  update: (token: string, id: string, input: Partial<CategoryInput>) =>
    apiFetch<Category>(`/categories/${id}`, { method: 'PATCH', body: input, accessToken: token }),
  remove: (token: string, id: string) =>
    apiFetch<void>(`/categories/${id}`, { method: 'DELETE', accessToken: token }),
  reorder: (token: string, categoryIds: string[]) =>
    apiFetch<Category[]>('/categories/reorder', {
      method: 'POST',
      body: { categoryIds },
      accessToken: token,
    }),
};

export const productsApi = {
  list: (token: string) => apiFetch<Product[]>('/products', { accessToken: token }),
  create: (token: string, input: ProductInput) =>
    apiFetch<Product>('/products', { method: 'POST', body: input, accessToken: token }),
  update: (token: string, id: string, input: Partial<ProductInput>) =>
    apiFetch<Product>(`/products/${id}`, { method: 'PATCH', body: input, accessToken: token }),
  remove: (token: string, id: string) =>
    apiFetch<void>(`/products/${id}`, { method: 'DELETE', accessToken: token }),
  duplicate: (token: string, id: string) =>
    apiFetch<Product>(`/products/${id}/duplicate`, { method: 'POST', accessToken: token }),
  uploadPhoto: (token: string, id: string, file: Blob) =>
    apiFetch<Product>(`/products/${id}/photo`, {
      method: 'PUT',
      body: imageForm(file),
      accessToken: token,
    }),
  removePhoto: (token: string, id: string) =>
    apiFetch<Product>(`/products/${id}/photo`, { method: 'DELETE', accessToken: token }),
  setOptionGroups: (token: string, id: string, groupIds: string[]) =>
    apiFetch<Product>(`/products/${id}/option-groups`, {
      method: 'PUT',
      body: { groupIds },
      accessToken: token,
    }),
  reorder: (token: string, categoryId: string, productIds: string[]) =>
    apiFetch<Product[]>('/products/reorder', {
      method: 'POST',
      body: { categoryId, productIds },
      accessToken: token,
    }),
};

export const optionGroupsApi = {
  list: (token: string) => apiFetch<OptionGroup[]>('/option-groups', { accessToken: token }),
  create: (token: string, input: OptionGroupInput) =>
    apiFetch<OptionGroup>('/option-groups', { method: 'POST', body: input, accessToken: token }),
  update: (token: string, id: string, input: Partial<OptionGroupInput>) =>
    apiFetch<OptionGroup>(`/option-groups/${id}`, {
      method: 'PATCH',
      body: input,
      accessToken: token,
    }),
  remove: (token: string, id: string) =>
    apiFetch<void>(`/option-groups/${id}`, { method: 'DELETE', accessToken: token }),
  setProducts: (token: string, id: string, productIds: string[]) =>
    apiFetch<OptionGroup>(`/option-groups/${id}/products`, {
      method: 'PUT',
      body: { productIds },
      accessToken: token,
    }),
  addOption: (token: string, groupId: string, input: OptionItemInput) =>
    apiFetch<OptionGroup>(`/option-groups/${groupId}/options`, {
      method: 'POST',
      body: input,
      accessToken: token,
    }),
  updateOption: (
    token: string,
    groupId: string,
    optionId: string,
    input: Partial<OptionItemInput>,
  ) =>
    apiFetch<OptionGroup>(`/option-groups/${groupId}/options/${optionId}`, {
      method: 'PATCH',
      body: input,
      accessToken: token,
    }),
  removeOption: (token: string, groupId: string, optionId: string) =>
    apiFetch<OptionGroup>(`/option-groups/${groupId}/options/${optionId}`, {
      method: 'DELETE',
      accessToken: token,
    }),
  reorderOptions: (token: string, groupId: string, optionIds: string[]) =>
    apiFetch<OptionGroup>(`/option-groups/${groupId}/options/reorder`, {
      method: 'POST',
      body: { optionIds },
      accessToken: token,
    }),
};
