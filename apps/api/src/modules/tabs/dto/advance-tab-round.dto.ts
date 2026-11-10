import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export const ROUND_FROM = ['SENT', 'PREPARING', 'READY'] as const;
export const ROUND_TO = ['PREPARING', 'READY', 'SERVED'] as const;

// B9: the kitchen moves the items of a round that are in `from` (the stage its card shows) to
// `to`. Saying where they come from makes a double click, or two screens acting at once, a clear
// refusal instead of moving the round two steps.
export class AdvanceTabRoundDto {
  @ApiProperty({ enum: ROUND_FROM })
  @IsIn(ROUND_FROM, { message: 'Estado de origem inválido.' })
  from!: (typeof ROUND_FROM)[number];

  @ApiProperty({ enum: ROUND_TO })
  @IsIn(ROUND_TO, { message: 'Estado de destino inválido.' })
  to!: (typeof ROUND_TO)[number];
}
