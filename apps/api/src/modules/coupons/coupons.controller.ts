import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { CouponsService } from './coupons.service';
import { CreateCouponDto, ListCouponsQueryDto, UpdateCouponDto } from './dto/coupons.dto';

// Administration only. tenantId always comes from the JWT (@CurrentUser); no route, query or
// body field carries it. Using a coupon in an order is NOT here: it goes through the existing
// order flows (PDV / public checkout) and needs coupons.apply, not these permissions.
// There is no DELETE: coupons are deactivated, so used coupons keep their history.
@ApiTags('coupons')
@ApiBearerAuth()
@Controller('coupons')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  @RequirePermissions('coupons.read')
  @ApiOperation({
    summary: 'Lista cupons do restaurante, com busca por código, filtro ativo/inativo e paginação',
  })
  list(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: ListCouponsQueryDto) {
    return this.coupons.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('coupons.read')
  @ApiOperation({ summary: 'Detalhe do cupom' })
  findOne(@CurrentUser() user: AuthenticatedRequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.coupons.findOne(user, id);
  }

  @Post()
  @RequirePermissions('coupons.create')
  @ApiOperation({
    summary: 'Cria um cupom (código normalizado; único entre os ativos do restaurante)',
  })
  create(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: CreateCouponDto) {
    return this.coupons.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('coupons.update')
  @ApiOperation({
    summary: 'Edita regras do cupom (código, unidade e ativação não mudam por aqui)',
  })
  update(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCouponDto,
  ) {
    return this.coupons.update(user, id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('coupons.update')
  @ApiOperation({ summary: 'Ativa o cupom (conflito se já houver outro ativo com o mesmo código)' })
  activate(@CurrentUser() user: AuthenticatedRequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.coupons.activate(user, id);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('coupons.update')
  @ApiOperation({ summary: 'Desativa o cupom (nunca exclui)' })
  deactivate(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.coupons.deactivate(user, id);
  }
}
