import { ConflictException, NotFoundException } from '@nestjs/common';

// Another tenant's customer is "not found" too: nothing about other tenants leaks.
export function customerNotFound() {
  return new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'Cliente não encontrado.' });
}

// `details.customerId` is a customer of the SAME tenant, so the screen can offer to open it.
export function customerPhoneTaken(customerId?: string) {
  return new ConflictException({
    code: 'CUSTOMER_PHONE_TAKEN',
    message: 'Já existe um cliente ativo com este telefone.',
    ...(customerId ? { details: { customerId } } : {}),
  });
}

export function customerCpfTaken(customerId?: string) {
  return new ConflictException({
    code: 'CUSTOMER_CPF_TAKEN',
    message: 'Já existe um cliente com este CPF.',
    ...(customerId ? { details: { customerId } } : {}),
  });
}

export function customerInactive() {
  return new ConflictException({
    code: 'CUSTOMER_INACTIVE',
    message: 'Este cliente está inativo e não pode ser vinculado a novos pedidos.',
  });
}
