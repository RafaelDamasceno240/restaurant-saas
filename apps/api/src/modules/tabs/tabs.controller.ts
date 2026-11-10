import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { TabsService } from './tabs.service';
import { CreateTabDto } from './dto/create-tab.dto';
import { SendTabRoundDto } from './dto/send-tab-round.dto';
import { CancelTabItemDto } from './dto/cancel-tab-item.dto';
import { TabRoundsService } from './tab-rounds.service';
import { TabKitchenService } from './tab-kitchen.service';
import { ListTabsQueryDto } from './dto/list-tabs-query.dto';
import { CheckoutTabDto } from './dto/checkout-tab.dto';

// Item mutations are gated by tabs.update — the spec only lists
// tabs.read/create/update/close, no separate item-level permission. B9: items
// arrive in rounds sent to the kitchen and are never edited or deleted after.
@ApiTags('tabs')
@ApiBearerAuth()
@Controller('tabs')
export class TabsController {
  constructor(
    private readonly tabsService: TabsService,
    private readonly rounds: TabRoundsService,
    private readonly kitchen: TabKitchenService,
  ) {}

  @Get()
  @RequirePermissions('tabs.read')
  @ApiOperation({ summary: 'Lista comandas de uma unidade (abertas por padrão)' })
  findAll(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: ListTabsQueryDto) {
    return this.tabsService.findAllForBranch(user, query);
  }

  @Get(':id')
  @RequirePermissions('tabs.read')
  @ApiOperation({ summary: 'Detalhe de uma comanda: mesa, itens e total' })
  findOne(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string) {
    return this.tabsService.findOneForTenant(user, id);
  }

  @Post()
  @RequirePermissions('tabs.create')
  @ApiOperation({ summary: 'Abre uma comanda para uma mesa (409 se a mesa já estiver ocupada)' })
  open(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: CreateTabDto) {
    return this.tabsService.open(user, dto);
  }

  // B9: "Enviar para a cozinha" - the waiter's whole draft becomes one round: items created and
  // recipes consumed together, or nothing (409 PRODUCT_OUT_OF_STOCK, closed tab...). 201 for a new
  // round, 200 for a repeated idempotencyKey (`idempotentReplay: true`, nothing new written).
  @Post(':id/rounds')
  @RequirePermissions('tabs.update')
  @ApiOperation({ summary: 'Envia uma rodada de itens para a cozinha (baixa o estoque; idempotente por idempotencyKey)' })
  async sendRound(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id') id: string,
    @Body() dto: SendTabRoundDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.rounds.send(user, id, dto);
    if (result.idempotentReplay) res.status(HttpStatus.OK);
    return result;
  }

  // B9: cancels some or all units of a sent item, with a reason. tabs.update for an item the
  // kitchen has not started (its ingredients go back); orders.cancel too once it is in
  // preparation, ready or delivered (checked by the service: it depends on the item's status).
  @Post(':id/items/:itemId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('tabs.update')
  @ApiOperation({ summary: 'Cancela unidades de um item da comanda (motivo obrigatório)' })
  cancelItem(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: CancelTabItemDto,
  ) {
    return this.rounds.cancelItem(user, id, itemId, dto);
  }

  // B9: the waiter took this item to the table (from any state still in production). Production,
  // not billing: also allowed after the bill was paid.
  @Post(':id/items/:itemId/serve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('tabs.update')
  @ApiOperation({ summary: 'Marca um item da comanda como entregue na mesa' })
  serveItem(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.kitchen.serveItem(user, id, itemId);
  }

  // Fatia 10: replaces the old operational POST /:id/close — closing a tab now
  // always means selling it. 200 for both the first call and an idempotent
  // replay (same key); `idempotentReplay` in the body tells them apart.
  @Post(':id/checkout')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('tabs.close')
  @ApiOperation({ summary: 'Fecha a comanda como venda paga (atômico e idempotente por idempotencyKey)' })
  checkout(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id') id: string,
    @Body() dto: CheckoutTabDto,
  ) {
    return this.tabsService.checkout(user, id, dto);
  }

  // B9: frees the table of a tab with nothing to charge (every item cancelled, or none sent),
  // without a sale. 409 TAB_HAS_ITEMS_TO_CHARGE while any unit is still due.
  @Post(':id/close-empty')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('tabs.close')
  @ApiOperation({ summary: 'Fecha uma comanda sem nada a cobrar, sem gerar venda' })
  closeEmpty(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string) {
    return this.tabsService.closeEmpty(user, id);
  }
}
