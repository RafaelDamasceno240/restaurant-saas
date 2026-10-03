import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { PosOrdersService } from './pos-orders.service';
import { CreatePosOrderDto } from './dto/create-pos-order.dto';
import { PosCouponPreviewDto } from '../coupons/dto/coupons.dto';

@ApiTags('pos')
@ApiBearerAuth()
@Controller('pos/orders')
export class PosOrdersController {
  constructor(private readonly posOrdersService: PosOrdersService) {}

  @Post()
  @RequirePermissions('pos.create')
  @ApiOperation({ summary: 'Cria um pedido de balcão (source=COUNTER); preço sempre recalculado no backend' })
  createOrder(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: CreatePosOrderDto) {
    return this.posOrdersService.createOrder(user, dto);
  }

  @Post('coupon-preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('coupons.apply')
  @ApiOperation({ summary: 'Prévia somente-leitura do desconto de um cupom para esta venda (não consome nada)' })
  previewCoupon(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: PosCouponPreviewDto) {
    return this.posOrdersService.previewCoupon(user, dto);
  }
}
