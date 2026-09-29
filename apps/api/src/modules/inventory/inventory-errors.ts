import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export function inventoryItemNotFound() {
  return new NotFoundException({ code: 'INVENTORY_ITEM_NOT_FOUND', message: 'Insumo não encontrado.' });
}

export function productNotFound() {
  return new NotFoundException({ code: 'NOT_FOUND', message: 'Produto não encontrado.' });
}

export function inventoryItemInactive() {
  return new ConflictException({ code: 'INVENTORY_ITEM_INACTIVE', message: 'Este insumo está inativo.' });
}

export function invalidStockLimits() {
  return new BadRequestException({
    code: 'INVALID_STOCK_LIMITS',
    message: 'O estoque máximo deve ser maior ou igual ao mínimo.',
  });
}

export function duplicateItems(message: string) {
  return new BadRequestException({ code: 'DUPLICATE_ITEM', message });
}

export function mapUniqueSkuError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new ConflictException({ code: 'SKU_ALREADY_EXISTS', message: 'Já existe um insumo com este SKU.' });
  }
  return error;
}

export function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}
