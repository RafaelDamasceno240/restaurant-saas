import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { PublicOrdersService } from './public-orders.service';
import { CreateOrderDto, PublicCouponPreviewDto } from './dto/create-order.dto';
import { OrderResponseDto, PublicOrderConfirmationDto } from './dto/order-response.dto';

@ApiTags('public-orders')
@Public()
@Controller('public/orders')
export class PublicOrdersController {
  constructor(private readonly publicOrdersService: PublicOrdersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Cria um pedido (convidado) — preço/nome sempre recalculados no backend' })
  // CreateOrderDto is @AllowExtraFields() — see that decorator and
  // StrictValidationPipe for why a route-level @UsePipes() override can't do
  // this on its own.
  createOrder(@Body() dto: CreateOrderDto): Promise<OrderResponseDto> {
    return this.publicOrdersService.createOrder(dto);
  }

  // Tighter than the global limit: this answers "is this code good?" to anyone, so it must not
  // be a cheap oracle for guessing codes.
  @Post('coupon-preview')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Prévia somente-leitura do desconto de um cupom (não consome nada; resposta genérica se recusado)' })
  previewCoupon(@Body() dto: PublicCouponPreviewDto) {
    return this.publicOrdersService.previewCoupon(dto);
  }

  @Get(':slug/:orderId')
  @ApiOperation({
    summary:
      'Busca um pedido para a página de confirmação (público, escopado por slug — resposta sem dados pessoais do cliente)',
  })
  getOrder(
    @Param('slug') slug: string,
    @Param('orderId') orderId: string,
  ): Promise<PublicOrderConfirmationDto> {
    return this.publicOrdersService.findPublicOrder(slug, orderId);
  }
}
