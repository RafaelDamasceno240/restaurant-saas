import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { MAX_UNITS_PER_PRODUCT } from '../../../common/util/item-quantity.util';
import { CANCEL_REASON_MAX, CANCEL_REASON_MIN } from '../../orders/dto/update-order-status.dto';

const CANCEL_REASON_MESSAGE = `Informe o motivo do cancelamento (de ${CANCEL_REASON_MIN} a ${CANCEL_REASON_MAX} caracteres).`;
const QUANTITY_MESSAGE = 'Informe quantas unidades cancelar (pelo menos 1).';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// B9: cancels some (or all) units of an item already sent to the kitchen. Never a price, never an
// item status: what happens to the stock follows from the item's status (TabRoundsService).
export class CancelTabItemDto {
  @ApiProperty({ example: 1, description: 'Unidades a cancelar (no máximo as que ainda estão ativas)' })
  @IsInt({ message: QUANTITY_MESSAGE })
  @Min(1, { message: QUANTITY_MESSAGE })
  @Max(MAX_UNITS_PER_PRODUCT, { message: `No máximo ${MAX_UNITS_PER_PRODUCT} unidades.` })
  quantity!: number;

  // Same rule as the order cancellation (B5): always said, spaces alone do not count.
  @ApiProperty({ description: `${CANCEL_REASON_MIN} a ${CANCEL_REASON_MAX} caracteres` })
  @Transform(trimmed)
  @IsString({ message: CANCEL_REASON_MESSAGE })
  @MinLength(CANCEL_REASON_MIN, { message: CANCEL_REASON_MESSAGE })
  @MaxLength(CANCEL_REASON_MAX, { message: CANCEL_REASON_MESSAGE })
  reason!: string;

  // Only for an item already in preparation or ready (manager): true = its ingredients go back to
  // the stock instead of being lost. Ignored for an item not started yet (always goes back);
  // refused for an item already delivered (never goes back).
  @ApiPropertyOptional({ description: 'Em preparo/pronto: true = voltou ao estoque (padrão: perda)' })
  @IsOptional()
  @IsBoolean({ message: 'returnToStock deve ser verdadeiro ou falso.' })
  returnToStock?: boolean;
}
