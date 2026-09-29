import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

// Mesas são sempre uma tela por unidade (mesmo padrão de operação do PDV/
// Caixa) — diferente de /v1/orders, branchId aqui é obrigatório, não um
// filtro opcional.
export class ListTablesQueryDto {
  @ApiProperty()
  @IsUUID()
  branchId!: string;
}
