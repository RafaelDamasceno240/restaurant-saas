import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  registerDecorator,
  ValidateIf,
  ValidationOptions,
} from 'class-validator';
import { OpeningInterval, openingHoursProblem } from '../opening-hours';
import {
  normalizeInstagram,
  normalizePhone,
  normalizeState,
  normalizeZipCode,
  PHONE_INPUT_PATTERN,
} from '../profile-input';

export const MAX_DESCRIPTION = 500;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const blankToNull = ({ value }: { value: unknown }) => {
  const text = typeof value === 'string' ? value.trim() : value;
  return text === '' ? null : text;
};

// Semantic validators: the same functions the service uses to normalize, so "valid in the
// DTO" and "storable" can never disagree. `describe` builds the message from the value.
function validateBy(
  name: string,
  check: (value: unknown) => boolean,
  { describe, ...options }: ValidationOptions & { describe?: (value: unknown) => string },
) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name,
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate: check,
        defaultMessage: describe ? (args) => describe(args?.value) : undefined,
      },
    });
}
const isText = (check: (v: string) => unknown) => (v: unknown) =>
  typeof v === 'string' && check(v) !== null;

const IsProfilePhone = () =>
  validateBy('isProfilePhone', isText(normalizePhone), {
    message: 'Telefone inválido: informe de 8 a 15 dígitos.',
  });
const IsInstagram = () =>
  validateBy('isInstagram', isText(normalizeInstagram), {
    message: 'Instagram inválido: use só letras, números, ponto e sublinhado (até 30).',
  });
const IsZipCode = () =>
  validateBy('isZipCode', isText(normalizeZipCode), { message: 'CEP em formato inválido.' });
const IsState = () => validateBy('isState', isText(normalizeState), { message: 'UF inválida.' });
const IsOpeningHours = () =>
  validateBy('isOpeningHours', (v) => openingHoursProblem(v) === null, {
    describe: (v) => openingHoursProblem(v) ?? 'Horários inválidos.',
  });

// Partial update of the profile: only the keys sent change. Name and legal name can be changed
// but never cleared; every other field accepts null (or blank text) to clear it. The document
// (CPF/CNPJ) and the slug are not here: they identify the restaurant and stay as registered.
// tenantId never appears here (forbidNonWhitelisted rejects it).
export class UpdateRestaurantProfileDto {
  @ApiPropertyOptional({ example: "Do'cê Hamburgueria" })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: "Do'cê Alimentos LTDA" })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  legalName?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: `Apresentação no cardápio (até ${MAX_DESCRIPTION} caracteres)`,
  })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(MAX_DESCRIPTION)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '@docehamburgueria' })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(31)
  @IsInstagram()
  instagram?: string | null;

  // Main color of the public menu (buttons, highlights), "#RRGGBB". null returns to the default.
  @ApiPropertyOptional({ nullable: true, example: '#C8102E' })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Cor inválida: use o formato #RRGGBB (ex.: #C8102E).' })
  brandColor?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '(11) 3456-7890' })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @Matches(PHONE_INPUT_PATTERN, { message: 'Telefone em formato inválido.' })
  @IsProfilePhone()
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '(11) 98765-4321' })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @Matches(PHONE_INPUT_PATTERN, { message: 'WhatsApp em formato inválido.' })
  @IsProfilePhone()
  whatsapp?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Contato interno; não aparece no cardápio' })
  @IsOptional()
  @Transform(blankToNull)
  @IsEmail()
  @MaxLength(120)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Rua das Flores' })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(200)
  address?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '120' })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(20)
  number?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(120)
  complement?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(120)
  neighborhood?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(120)
  city?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'MG' })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @IsState()
  state?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '01310-100' })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @IsZipCode()
  zipCode?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Lista completa da semana (substitui a anterior): [{ weekday 0-6 (0 = domingo), opens "HH:MM", closes "HH:MM" }]. ' +
      'Fechamento antes da abertura = depois da meia-noite. Dia sem horário = fechado. [] = fechado todos os dias; null = não informado.',
    example: [{ weekday: 5, opens: '18:00', closes: '02:00' }],
  })
  @IsOptional()
  @IsOpeningHours()
  openingHours?: OpeningInterval[] | null;
}
