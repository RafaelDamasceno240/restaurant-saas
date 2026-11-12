import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { WhatsappConversationStatus } from '@prisma/client';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const blankToNull = ({ value }: { value: unknown }) => {
  const text = typeof value === 'string' ? value.trim() : value;
  return text === '' ? null : text;
};

export const MESSAGE_MAX = 1000;

export class UpdateWhatsappSettingsDto {
  @ApiPropertyOptional({ description: 'Liga ou desliga as respostas automáticas do assistente.' })
  @IsOptional()
  @IsBoolean()
  assistantEnabled?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 500,
    description: 'Enviada na primeira resposta de cada conversa.',
  })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(500)
  greetingMessage?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 1000,
    description:
      'Tom e orientações de atendimento. Não muda preços nem regras: esses vêm sempre do cardápio.',
  })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(1000)
  behaviorInstructions?: string | null;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 10000,
    description: 'Respostas do assistente por dia (controle de custo).',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  aiDailyReplyLimit?: number;
}

export class AgentReplyDto {
  @ApiProperty({ maxLength: MESSAGE_MAX })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(MESSAGE_MAX)
  text!: string;
}

export class ListConversationsQueryDto {
  @ApiPropertyOptional({ enum: WhatsappConversationStatus })
  @IsOptional()
  @IsEnum(WhatsappConversationStatus)
  status?: WhatsappConversationStatus;
}

export class SimulateMessageDto {
  @ApiProperty({ example: 'Ana (teste)' })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  contactName!: string;

  @ApiProperty({ example: '99999-0001', description: 'Telefone fictício do cliente simulado.' })
  @Transform(trimmed)
  @IsString()
  @Matches(/^[\d\s()+-]{4,20}$/, { message: 'Telefone inválido.' })
  contactPhone!: string;

  @ApiProperty({ maxLength: MESSAGE_MAX })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(MESSAGE_MAX)
  text!: string;
}
